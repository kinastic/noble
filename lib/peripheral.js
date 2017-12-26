/*jshint loopfunc: true */
const debug = require('debug')('peripheral');
const Rx = require('rxjs/Rx');

const Service = require('./service');

class Peripheral {
  constructor(noble, address, addressType, connectable, advertisement, rssi) {
    this.source = new Rx.Subject();
    this.noble = noble;

    // this.address = id;
    // this.uuid = id; // for legacy
    this.address = address;
    this.addressType = addressType;
    this.connectable = connectable;
    this.advertisement = advertisement;
    this.rssi = rssi;
    this.services = [];
    this.state = 'disconnected';
  }

  handleGattEvent(event, payload) {
    switch (event) {
      case 'rssiUpdate':
        this.onRssiRead(payload);
        break;
      case 'disconnect':
        this.onDisconnect(payload);
        break;
    }
  }

  async connect() {
    if (!this.gatt) {
      this.state = 'connecting';
      this.gatt = await this.noble.connectGatt(this.address);
      this.state = 'connected';
      this.gattSubscription = this.gatt.source.subscribe(({ event, payload }) => {
        this.handleGattEvent(event, payload);
      });
    }
    return true;
  }

  async disconnect() {
    if (this.gatt) {
      this.state = 'disconnecting';
      await this.gatt.disconnect(this.address);
    }
    return true;
  }

  updateRssi(callback) {
    // if (callback) {
    //   this.once('rssiUpdate', (rssi) => {
    //     callback(null, rssi);
    //   });
    // }

    this.gatt.updateRssi(this.address);
  }

  async discoverServices() {
    if (this.gatt) {
      const services = await  this.gatt.discoverServices();
      services
        .filter(({ uuid: serviceUuid }) => -1 === this.services.findIndex(({ uuid }) => uuid === serviceUuid))
        .forEach((uuid) => {
          this.services.push(new Service(this.gatt, this.address, uuid));
        });
      return services;
    }
    return Promise.reject(new Error("Gatt is NULL"));
  }

  readHandle(handle, callback) {
    // if (callback) {
    //   this.once('handleRead' + handle, (data) => {
    //     callback(null, data);
    //   });
    // }

    this.gatt.readHandle(this.address, handle);
  }

  writeHandle(handle, data, withoutResponse, callback) {
    if (!(data instanceof Buffer)) {
      throw new Error('data must be a Buffer');
    }

    if (callback) {
      // this.once('handleWrite' + handle, () => {
      //   callback(null);
      // });
    }

    this.gatt.writeHandle(this.address, handle, data, withoutResponse);
  }

  onRssiRead({ rssi }) {
    this.source.next({ event: 'rssiUpdate', payload: { rssi }});
  }

  onDisconnect({ handle, reason }) {
    this.state = 'disconnected';
    if (this.gatt) {
      this.gattSubscription.unsubscribe();
      this.source.next({ event: 'disconnect', payload: { reason }});
    }
    this.gatt = null;
  }

  toString() {
    return JSON.stringify({
      address: this.address,
      addressType: this.addressType,
      connectable: this.connectable,
      advertisement: this.advertisement,
      rssi: this.rssi,
      state: this.state
    });
  }
}

module.exports = Peripheral;
