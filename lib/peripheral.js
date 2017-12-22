/*jshint loopfunc: true */
const debug = require('debug')('peripheral');

const events = require('events');
const util = require('util');

class Peripheral extends events.EventEmitter {
  constructor(noble, address, addressType, connectable, advertisement, rssi) {
    super();
    this._noble = noble;

    // this.address = id;
    // this.uuid = id; // for legacy
    this.address = address;
    this.addressType = addressType;
    this.connectable = connectable;
    this.advertisement = advertisement;
    this.rssi = rssi;
    this.services = null;
    this.state = 'disconnected';
  }

  connect() {
    if (this.state === 'connected') {
      return Promise.resolve();
    }
    this.state = 'connecting';
    return this._noble.connect(this.address);
  }

  disconnect() {
    return new Promise((resolve, reject) => {
      this.once('disconnect', () => {
        resolve();
      });
      this.state = 'disconnecting';
      this._noble.disconnect(this.address);
    });
  }

  updateRssi(callback) {
    if (callback) {
      this.once('rssiUpdate', (rssi) => {
        callback(null, rssi);
      });
    }

    this._noble.updateRssi(this.address);
  }

  discoverServices(uuids) {
    if (!this.discoverPromise) {
      this.discoverPromise = new Promise((resolve, reject) => {
        this.once('servicesDiscover', (services) => {
          resolve(services);
          this.discoverPromise = null;
        });
        this._noble.discoverServices(this.address, uuids);
      });
    }

    return this.discoverPromise;
  }

  readHandle(handle, callback) {
    if (callback) {
      this.once('handleRead' + handle, (data) => {
        callback(null, data);
      });
    }

    this._noble.readHandle(this.address, handle);
  }

  writeHandle(handle, data, withoutResponse, callback) {
    if (!(data instanceof Buffer)) {
      throw new Error('data must be a Buffer');
    }

    if (callback) {
      this.once('handleWrite' + handle, () => {
        callback(null);
      });
    }

    this._noble.writeHandle(this.address, handle, data, withoutResponse);
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
