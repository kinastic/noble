/*jshint loopfunc: true */
const debug = require('debug')('peripheral');

const events = require('events');
const util = require('util');

class Peripheral extends events.EventEmitter {
  constructor(noble, id, address, addressType, connectable, advertisement, rssi) {
    super();
    this._noble = noble;

    this.id = id;
    this.uuid = id; // for legacy
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
    return this._noble.connect(this.id);
    // return new Promise((resolve, reject) => {
    //   if (this.state === 'connected') {
    //     resolve();
    //   } else {
    //     this.state = 'connecting';
    //     this._noble.connect(this.id);
    //   }
    // });
    // if (callback) {
    //   this.once('connect', (error) => {
    //     callback(error);
    //   });
    // }
    //
    // if (this.state === 'connected') {
    //   this.emit('connect', new Error('Peripheral already connected'));
    // } else {
    //   this.state = 'connecting';
    //   this._noble.connect(this.id);
    // }
  }

  disconnect() {
    return new Promise((resolve, reject) => {
      this.once('disconnect', () => {
        resolve();
      });
      this.state = 'disconnecting';
      this._noble.disconnect(this.id);
    });
  }

  updateRssi(callback) {
    if (callback) {
      this.once('rssiUpdate', (rssi) => {
        callback(null, rssi);
      });
    }

    this._noble.updateRssi(this.id);
  }

  discoverServices(uuids) {
    return new Promise((resolve, reject) => {
      this.once('servicesDiscover', (services) => {
        resolve(services);
      });
      this._noble.discoverServices(this.id, uuids);
    });
  }

  discoverSomeServicesAndCharacteristics(serviceUuids, characteristicsUuids, callback) {
    this.discoverServices(serviceUuids, (err, services) => {
      let numDiscovered = 0;
      let allCharacteristics = [];

      for (const service of services) {
        service.discoverCharacteristics(characteristicsUuids, (error, characteristics) => {
          numDiscovered++;

          if (error === null) {
            for (const characteristic of characteristics) {
              allCharacteristics.push(characteristic);
            }
          }

          if (numDiscovered === services.length) {
            if (callback) {
              callback(null, services, allCharacteristics);
            }
          }
        });
      }
    });
  }

  discoverAllServicesAndCharacteristics(callback) {
    this.discoverSomeServicesAndCharacteristics([], [], callback);
  }

  readHandle(handle, callback) {
    if (callback) {
      this.once('handleRead' + handle, (data) => {
        callback(null, data);
      });
    }

    this._noble.readHandle(this.id, handle);
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

    this._noble.writeHandle(this.id, handle, data, withoutResponse);
  }

  toString() {
    return JSON.stringify({
      id: this.id,
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
