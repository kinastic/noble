const debug = require('debug')('bindings');

const events = require('events');
const util = require('util');

const CommandResolver = require('../CommandResolver');
const AclStream = require('./acl-stream');
const Gatt = require('./gatt');
const Gap = require('./gap');
const Hci = require('./hci');
const Signaling = require('./signaling');


class NobleBindings extends events.EventEmitter {
  constructor(hciId = 0, userMode = false) {
    super();
    this._hciId = hciId;
    this._state = null;
    this._userMode = userMode;
    this._connectResolvers = {};
    this._connectPromises = {};

    this._addresseTypes = {};
    this._connectable = {};

    this._pendingConnectionAddress = null;
    this._connectionQueue = [];

    this._handles = {};
    this._gatts = {};
    this._gattSubscriptions = {};
    this._aclStreams = {};
    this._signalings = {};
    this._signalingSubscriptions = {};

    this._hci = new Hci(hciId, userMode);
    this.hciSubscription = this._hci.source.subscribe(({ event, payload }) => {
      this.handleHciEvent(event, payload);
    });

    this._gap = new Gap(this._hci);
    this.gapSubscription = this._gap.source.subscribe(({ event, payload }) => {
      this.handleGapEvent(event, payload);
    });
  }

  startScanning(serviceUuids, allowDuplicates) {
    this._gap.startScanning(allowDuplicates);
  }

  stopScanning() {
    this._gap.stopScanning();
  }

  connect(address) {
    const addressType = this._addresseTypes[address];

    const connectResolver = this._connectPromises[address];
    if (connectResolver) {
      return connectResolver;
    }
    const promise = new Promise((resolve, reject) => {
      this._connectResolvers[address] = new CommandResolver(resolve, reject);
      if (!this._pendingConnectionAddress) {
        this._pendingConnectionAddress = address;

        this._hci.createLeConn(address, addressType);
      } else {
        this._connectionQueue.push(address);
      }
    });
    this._connectPromises[address] = promise;
    return promise;
  }

  disconnect(peripheralUuid) {
    this._hci.disconnect(this._handles[peripheralUuid]);
  }

  updateRssi(peripheralUuid) {
    this._hci.readRssi(this._handles[peripheralUuid]);
  }

  init() {
    this.onSigIntBinded = this.onSigInt.bind(this);

    this._hci.init();

    /* Add exit handlers after `init()` has completed. If no adaptor
    is present it can throw an exception - in which case we don't
    want to try and clear up afterwards (issue #502) */
    process.on('SIGINT', this.onSigIntBinded);
    process.on('exit', this.onExit.bind(this));
  }

  handleHciEvent(event, payload) {
    switch (event) {
      case 'leConnComplete': this.onLeConnComplete(payload);
        break;
      case 'stateChange': this.onStateChange(payload);
        break;
      case 'addressChange': this.onAddressChange(payload);
        break;
      case 'leConnUpdateComplete': this.onLeConnUpdateComplete(payload);
        break;
      case 'rssiRead': this.onRssiRead(payload);
        break;
      case 'disconnComplete': this.onDisconnComplete(payload);
        break;
      case 'onEncryptChange': this.onEncryptChange(payload);
        break;
      case 'aclDataPkt': this.onAclDataPkt(payload);
        break;
    }
  }

  handleGapEvent(event, payload) {
    switch (event) {
      case 'scanStart': this.onScanStart(payload);
        break;
      case 'scanStop': this.onScanStop();
        break;
      case 'discover': this.onDiscover(payload);
        break;
    }
  }

  onSigInt() {
    const sigIntListeners = process.listeners('SIGINT');

    if (sigIntListeners[sigIntListeners.length - 1] === this.onSigIntBinded) {
      // we are the last listener, so exit
      // this will trigger onExit, and clean up
      process.exit(1);
    }
  }

  onExit() {
    this.stopScanning();

    const streams = Object.values(this._aclStreams);
    for (const handle of streams) {
      this._hci.disconnect(handle);
    }
  }

  onStateChange({ state }) {
    if (this._state === state) {
      return;
    }
    this._state = state;


    if (state === 'unauthorized') {
      console.log('noble warning: adapter state unauthorized, please run as root or with sudo');
      console.log('               or see README for information on running without root/sudo:');
      console.log('               https://github.com/sandeepmistry/noble#running-on-linux');
    } else if (state === 'unsupported') {
      console.log('noble warning: adapter does not support Bluetooth Low Energy (BLE, Bluetooth Smart).');
      console.log('               Try to run with environment constiable:');
      console.log('               [sudo] NOBLE_HCI_DEVICE_ID=x node ...');
    }

    this.emit('stateChange', state);
  }

  onAddressChange({ address }) {
    this.emit('addressChange', address);
  }

  onScanStart({ filterDuplicates }) {
    this.emit('scanStart', filterDuplicates);
  }

  onScanStop() {
    this.emit('scanStop');
  }

  onDiscover({ status, address, addressType, connectable, advertisement, rssi }) {
    this._addresseTypes[address] = addressType;
    this._connectable[address] = connectable;

    this.emit('discover', address, addressType, connectable, advertisement, rssi);
  }

  onLeConnComplete({ status, handle, role, addressType, address, interval, latency, supervisionTimeout, masterClockAccuracy }) {

    const promise = this._connectResolvers[this._pendingConnectionAddress];
    delete this._connectPromises[this._pendingConnectionAddress];
    delete this._connectResolvers[this._pendingConnectionAddress];

    if (status === 0) {
      const aclStream = new AclStream(this._hci, handle, this._hci.addressType, this._hci.address, addressType, address);
      const gatt = new Gatt(address, aclStream);
      const signaling = new Signaling(handle, aclStream, this._userMode);

      this._gatts[address] = this._gatts[handle] = gatt;
      this._signalings[address] = this._signalings[handle] = signaling;
      this._aclStreams[handle] = aclStream;
      this._handles[address] = handle;
      this._handles[handle] = address;

      this._gattSubscriptions[handle] = gatt.source.subscribe(({ event, payload }) => {
        this.handleGattEvent(event, payload);
      });

      this._signalingSubscriptions[handle] = signaling.source.subscribe(({ event, payload }) => {
        if (event === 'connectionParameterUpdateRequest') {
          this.onConnectionParameterUpdateRequest(payload);
        }
      });

      // this._gatts[handle].exchangeMtu(256);
      promise.resolve();
    } else {
      let statusMessage = this._hci.STATUS_MAPPER[status] || 'HCI Error: Unknown';
      const errorCode = ' (0x' + status.toString(16) + ')';
      statusMessage = statusMessage + errorCode;
      promise.reject(new Error(statusMessage));
    }

    // TODO test
    // this.emit('connect', uuid, error);

    if (this._connectionQueue.length > 0) {
      const peripheralAddress = this._connectionQueue.shift();

      addressType = this._addresseTypes[peripheralAddress];

      this._pendingConnectionAddress = peripheralAddress;

      this._hci.createLeConn(peripheralAddress, addressType);
    } else {
      this._pendingConnectionAddress = null;
    }
  }

  handleGattEvent(event, payload) {
    switch (event) {
      case 'mtu': this.onMtu(payload);
        break;
      case 'servicesDiscover': this.onServicesDiscovered(payload);
        break;
      case 'includedServicesDiscover': this.onIncludedServicesDiscovered(payload);
        break;
      case 'characteristicsDiscover': this.onCharacteristicsDiscovered(payload);
        break;
      case 'read': this.onRead(payload);
        break;
      case 'write': this.onWrite(payload);
        break;
      case 'broadcast': this.onBroadcast(payload);
        break;
      case 'notify': this.onNotify(payload);
        break;
      case 'notification': this.onNotification(payload);
        break;
      case 'descriptorsDiscover': this.onDescriptorsDiscovered(payload);
        break;
      case 'valueRead': this.onValueRead(payload);
        break;
      case 'valueWrite': this.onValueWrite(payload);
        break;
      case 'handleRead': this.onHandleRead(payload);
        break;
      case 'handleWrite': this.onHandleWrite(payload);
        break;
      case 'handleNotify': this.onHandleNotify(payload);
        break;
    }
  }

  onLeConnUpdateComplete({ handle, interval, latency, supervisionTimeout }) {
    // no-op
  }

  onDisconnComplete({ handle, reason }) {
    const address = this._handles[handle];

    if (address) {
      const gattSubscription = this._gattSubscriptions[handle];
      if (gattSubscription) {
        gattSubscription.unsubscribe();
      }
      this._aclStreams[handle].push(null, null);

      const signalingSubscription = this._signalingSubscriptions[handle];
      if (signalingSubscription) {
        signalingSubscription.unsubscribe();
      }

      delete this._gatts[address];
      delete this._gattSubscriptions[handle];
      delete this._gatts[handle];
      delete this._signalings[address];
      delete this._signalings[handle];
      delete this._aclStreams[handle];
      delete this._handles[address];
      delete this._handles[handle];

      this.emit('disconnect', address); // TODO: handle reason?
    } else {
      console.warn('noble warning: unknown handle ' + handle + ' disconnected!');
    }
  }

  onEncryptChange({ handle, encrypt }) {
    const aclStream = this._aclStreams[handle];

    if (aclStream) {
      aclStream.pushEncrypt(encrypt);
    }
  }

  onMtu({ address, mtu }) {

  }

  onRssiRead({ handle, rssi }) {
    this.emit('rssiUpdate', this._handles[handle], rssi);
  }


  onAclDataPkt({ handle, cid, data }) {
    const aclStream = this._aclStreams[handle];

    if (aclStream) {
      aclStream.push(cid, data);
    }
  }

  discoverServices(peripheralAddress, uuids) {
    const handle = this._handles[peripheralAddress];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.discoverServices(uuids || []);
    } else {
      console.warn('noble warning: unknown peripheral ' + peripheralAddress);
    }
  }

  onServicesDiscovered({ address, serviceUuids }) {
    this.emit('servicesDiscover', address, serviceUuids);
  }

  discoverIncludedServices(address, serviceUuid, serviceUuids) {
    const handle = this._handles[address];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.discoverIncludedServices(serviceUuid, serviceUuids || []);
    } else {
      console.warn('noble warning: unknown peripheral ' + address);
    }
  }

  onIncludedServicesDiscovered({ address, serviceUuid, includedServiceUuids }) {
    this.emit('includedServicesDiscover', address, serviceUuid, includedServiceUuids);
  }

  discoverCharacteristics(address, serviceUuid, characteristicUuids) {
    const handle = this._handles[address];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.discoverCharacteristics(serviceUuid, characteristicUuids || []);
    } else {
      console.warn('noble warning: unknown peripheral ' + address);
    }
  }

  onCharacteristicsDiscovered({ address, serviceUuid, characteristics }) {
    this.emit('characteristicsDiscover', address, serviceUuid, characteristics);
  }

  read(peripheralAddress, serviceUuid, characteristicUuid) {
    const handle = this._handles[peripheralAddress];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.read(serviceUuid, characteristicUuid);
    } else {
      console.warn('noble warning: unknown peripheral ' + peripheralAddress);
    }
  }

  onRead({ address, serviceUuid, characteristicUuid, readData }) {
    this.emit('read', address, serviceUuid, characteristicUuid, readData, false);
  }

  write(address, serviceUuid, characteristicUuid, data, withoutResponse) {
    const handle = this._handles[address];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.write(serviceUuid, characteristicUuid, data, withoutResponse);
    } else {
      console.warn('noble warning: unknown peripheral ' + address);
    }
  }

  onWrite({ address, serviceUuid, characteristicUuid }) {
    this.emit('write', address, serviceUuid, characteristicUuid);
  }

  broadcast(address, serviceUuid, characteristicUuid, broadcast) {
    const handle = this._handles[address];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.broadcast(serviceUuid, characteristicUuid, broadcast);
    } else {
      console.warn('noble warning: unknown peripheral ' + address);
    }
  }

  onBroadcast({ address, serviceUuid, characteristicUuid, state }) {
    this.emit('broadcast', address, serviceUuid, characteristicUuid, state);
  }

  notify(address, serviceUuid, characteristicUuid, notify) {
    const handle = this._handles[address];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.notify(serviceUuid, characteristicUuid, notify);
    } else {
      console.warn('noble warning: unknown peripheral ' + address);
    }
  }

  onNotify({ address, serviceUuid, characteristicUuid, state }) {
    this.emit('notify', address, serviceUuid, characteristicUuid, state);
  }

  onNotification({ address, serviceUuid, characteristicUuid, valueData }) {
    this.emit('read', address, serviceUuid, characteristicUuid, valueData, true);
  }

  discoverDescriptors(peripheralUuid, serviceUuid, characteristicUuid) {
    const handle = this._handles[peripheralUuid];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.discoverDescriptors(serviceUuid, characteristicUuid);
    } else {
      console.warn('noble warning: unknown peripheral ' + peripheralUuid);
    }
  }

  onDescriptorsDiscovered({ address, serviceUuid, characteristicUuid, descriptorUuids }) {
    this.emit('descriptorsDiscover', address, serviceUuid, characteristicUuid, descriptorUuids);
  }

  readValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid) {
    const handle = this._handles[peripheralUuid];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.readValue(serviceUuid, characteristicUuid, descriptorUuid);
    } else {
      console.warn('noble warning: unknown peripheral ' + peripheralUuid);
    }
  }

  onValueRead({ address, serviceUuid, characteristicUuid, descriptorUuid, data }) {
    this.emit('valueRead', address, serviceUuid, characteristicUuid, descriptorUuid, data);
  }

  writeValue(address, serviceUuid, characteristicUuid, descriptorUuid, data) {
    const handle = this._handles[address];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.writeValue(serviceUuid, characteristicUuid, descriptorUuid, data);
    } else {
      console.warn('noble warning: unknown peripheral ' + address);
    }
  }

  onValueWrite({ address, serviceUuid, characteristicUuid, descriptorUuid }) {
    this.emit('valueWrite', address, serviceUuid, characteristicUuid, descriptorUuid);
  }

  readHandle(peripheralUuid, attHandle) {
    const handle = this._handles[peripheralUuid];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.readHandle(attHandle);
    } else {
      console.warn('noble warning: unknown peripheral ' + peripheralUuid);
    }
  }

  onHandleRead({ address, handle, data }) {
    this.emit('handleRead', address, handle, data);
  }

  writeHandle(peripheralUuid, attHandle, data, withoutResponse) {
    const handle = this._handles[peripheralUuid];
    const gatt = this._gatts[handle];

    if (gatt) {
      gatt.writeHandle(attHandle, data, withoutResponse);
    } else {
      console.warn('noble warning: unknown peripheral ' + peripheralUuid);
    }
  }

  onHandleWrite({ address, handle }) {
    this.emit('handleWrite', address, handle);
  }

  onHandleNotify({ address, valueHandle, data }) {
    this.emit('handleNotify', address, valueHandle, data);
  }

  onConnectionParameterUpdateRequest({ handle, minInterval, maxInterval, latency, supervisionTimeout }) {
    this._hci.connUpdateLe(handle, minInterval, maxInterval, latency, supervisionTimeout);
  }
}

module.exports = NobleBindings;
