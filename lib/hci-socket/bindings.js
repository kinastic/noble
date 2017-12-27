const debug = require('debug')('bindings');

const events = require('events');

const CommandResolver = require('../CommandResolver');
const BluetoothGatt = require('./BluetoothGatt');
const Gap = require('./gap');
const Hci = require('./hci');


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

  connectGatt(address) {
    const addressType = this._addresseTypes[address];

    const connectPromise = this._connectPromises[address];
    if (connectPromise) {
      return connectPromise;
    }

    const gatt = this._gatts[address];
    if (gatt) {
      return Promise.resolve(gatt);
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
      case 'disconnComplete': this.onDisconnComplete(payload);
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

    const gatts = Object.values(this._gatts);
    for (const gatt of gatts) {
      gatt.disconnect();
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

    if (promise) {
      if (status === 0) {
        const gatt = new BluetoothGatt(this._hci, handle, address, addressType, this._userMode);
        this._gatts[address] = gatt;

        this._gatts[address] = this._gatts[handle] = gatt;
        this._handles[address] = handle;
        this._handles[handle] = address;

        // this._gatts[handle].exchangeMtu(256);
        promise.resolve(gatt);
      } else {
        let statusMessage = this._hci.STATUS_MAPPER[status] || 'HCI Error: Unknown';
        const errorCode = ' (0x' + status.toString(16) + ')';
        statusMessage = statusMessage + errorCode;
        promise.reject(new Error(statusMessage));
      }
    }

    if (this._connectionQueue.length > 0) {
      const peripheralAddress = this._connectionQueue.shift();

      addressType = this._addresseTypes[peripheralAddress];

      this._pendingConnectionAddress = peripheralAddress;

      this._hci.createLeConn(peripheralAddress, addressType);
    } else {
      this._pendingConnectionAddress = null;
    }
  }

  onDisconnComplete({ handle, reason }) {
    const address = this._handles[handle];

    if (address) {
      const promise = this._connectResolvers[address];
      delete this._connectPromises[address];
      delete this._connectResolvers[address];

      if (promise) { // got disconnect before connect (should not happen)
        promise.reject();
      }

      delete this._gatts[address];
      delete this._gattSubscriptions[handle];
      delete this._gatts[handle];
      delete this._handles[address];
      delete this._handles[handle];

      this.emit('disconnect', address); // TODO: handle reason?
    } else {
      console.warn('noble warning: unknown handle ' + handle + ' disconnected!');
    }
  }
}

module.exports = NobleBindings;
