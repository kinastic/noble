
const AclStream = require('./acl-stream');
const Gatt = require('./gatt');
const Signaling = require('./signaling');
const Service = require('../service');

const Rx = require('rxjs/Rx');

class BluetoothGatt {
  constructor(hci, handle, address, addressType, userMode) {
    this.source = new Rx.Subject();
    this.hci = hci;
    this.handle = handle;
    this.address = address;
    this.disconnectPromise = null;
    this.discoverPromise = null;
    this.aclStream = new AclStream(this.hci, handle, addressType, address);
    this.gatt = new Gatt(address, this.aclStream);
    this.signaling = new Signaling(handle, this.aclStream, userMode);

    this.gattSubscription = this.gatt.source.subscribe(({ event, payload }) => {
      this.handleGattEvent(event, payload);
    });

    this._signalingSubscription = this.signaling.source.subscribe(({ event, payload }) => {
      if (event === 'connectionParameterUpdateRequest') {
        this.onConnectionParameterUpdateRequest(payload);
      }
    });

    this.hciSubscription = this.hci.source
      .filter(({ payload }) => !!payload)
      .filter(({ payload: { handle }}) => handle === this.handle)
      .subscribe(({ event, payload }) => {
        this.handleHciEvent(event, payload);
      });
  }

  disconnect() {
    if (!this.disconnectPromise) {
      this.disconnectPromise = new Promise((resolve, reject) => {
        this.disconnectResolve = resolve;
        this.hci.disconnect(this.handle);
      });
    }

    return this.disconnectPromise;

  }

  handleHciEvent(event, payload) {
    switch (event) {
      case 'rssiRead': this.onRssiRead(payload);
        break;
      case 'disconnComplete': this.onDisconnComplete(payload);
        break;
    }
  }

  handleGattEvent(event, payload) {
    switch (event) {
      case 'mtu': this.onMtu(payload);
        break;
      case 'servicesDiscover': this.onServicesDiscovered(payload);
        break;
      // case 'includedServicesDiscover': this.onIncludedServicesDiscovered(payload);
      //   break;
      case 'write': this.onWrite(payload);
        break;
      case 'broadcast': this.onBroadcast(payload);
        break;
      case 'valueRead': this.onValueRead(payload);
        break;
      case 'valueWrite': this.onValueWrite(payload);
        break;
      case 'handleRead': this.onHandleRead(payload);
        break;
      case 'handleWrite': this.onHandleWrite(payload);
        break;
    }
  }

  discoverServices(uuids) {
    if (!this.discoverPromise) {
      this.discoverPromise = new Promise((resolve, reject) => {
        this.discoverResolve = resolve;
        this.gatt.discoverServices(uuids || []);
      });
    }

    return this.discoverPromise;
  }

  discoverIncludedServices(serviceUuid, serviceUuids) {
    this.gatt.discoverIncludedServices(serviceUuid, serviceUuids || []);
  }

  read(serviceUuid, characteristicUuid) {
    this.gatt.read(serviceUuid, characteristicUuid);
  }

  write(serviceUuid, characteristicUuid, data, withoutResponse) {
    this.gatt.write(serviceUuid, characteristicUuid, data, withoutResponse);
  }

  broadcast(serviceUuid, characteristicUuid, broadcast) {
    this.gatt.broadcast(serviceUuid, characteristicUuid, broadcast);
  }

  notify(serviceUuid, characteristicUuid, notify) {
    this.gatt.notify(serviceUuid, characteristicUuid, notify);
  }

  discoverDescriptors(serviceUuid, characteristicUuid) {
    this.gatt.discoverDescriptors(serviceUuid, characteristicUuid);
  }

  readValue(serviceUuid, characteristicUuid, descriptorUuid) {
    this.gatt.readValue(serviceUuid, characteristicUuid, descriptorUuid);
  }

  writeValue(serviceUuid, characteristicUuid, descriptorUuid, data) {
    this.gatt.writeValue(serviceUuid, characteristicUuid, descriptorUuid, data);
  }

  readHandle(attHandle) {
    this.gatt.readHandle(attHandle);
  }

  writeHandle(attHandle, data, withoutResponse) {
    this.gatt.writeHandle(attHandle, data, withoutResponse);
  }

  readRssi() {
    this.hci.readRssi(this.handle);
  }

  onMtu({ address, mtu }) {

  }

  onServicesDiscovered({ address, serviceUuids }) {
    if (this.discoverResolve) {
      const services = serviceUuids.map((uuid) => new Service(this.gatt, this.address, uuid));
      this.discoverResolve(services);
    }
    this.discoverResolve = null;
    this.discoverPromise = null;
  }

  onWrite({ address, serviceUuid, characteristicUuid }) {
    this.emit('write', address, serviceUuid, characteristicUuid);
  }

  onBroadcast({ address, serviceUuid, characteristicUuid, state }) {
    this.emit('broadcast', address, serviceUuid, characteristicUuid, state);
  }

  onValueRead({ address, serviceUuid, characteristicUuid, descriptorUuid, data }) {
    this.emit('valueRead', address, serviceUuid, characteristicUuid, descriptorUuid, data);
  }

  onValueWrite({ address, serviceUuid, characteristicUuid, descriptorUuid }) {
    this.emit('valueWrite', address, serviceUuid, characteristicUuid, descriptorUuid);
  }

  onHandleRead({ address, handle, data }) {
    this.emit('handleRead', address, handle, data);
  }

  onHandleWrite({ address, handle }) {
    this.emit('handleWrite', address, handle);
  }

  onConnectionParameterUpdateRequest({ handle, minInterval, maxInterval, latency, supervisionTimeout }) {
    this.hci.connUpdateLe(handle, minInterval, maxInterval, latency, supervisionTimeout);
  }

  onDisconnComplete({ handle, reason }) {
    if (this.gattSubscription) {
      this.gattSubscription.unsubscribe();
    }

    if (this._signalingSubscription) {
      this._signalingSubscription.unsubscribe();
    }

    if (this.disconnectResolve) {
      this.disconnectResolve();
    }
    this.disconnectResolve = null;
    this.disconnectPromise = null;

    this.source.next({ event: 'disconnect', payload: { handle, reason }});
  }

  onRssiRead({ handle, rssi }) {
    this.source.next({ event: 'rssiUpdate', payload: { rssi }});
  }
}

module.exports = BluetoothGatt;
