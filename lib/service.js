const debug = require('debug')('service');

const events = require('events');
const util = require('util');

const services = require('./services.json');

class Service extends events.EventEmitter {
  constructor(noble, peripheralAddress, uuid) {
    super();
    this._noble = noble;
    this._peripheralAddress = peripheralAddress;

    this.uuid = uuid;
    this.name = null;
    this.type = null;
    this.includedServiceUuids = null;
    this.characteristics = null;

    const service = services[uuid];
    if (service) {
      this.name = service.name;
      this.type = service.type;
    }
  }

  discoverIncludedServices(serviceUuids, callback) {
    if (callback) {
      this.once('includedServicesDiscover', (includedServiceUuids) => {
        callback(null, includedServiceUuids);
      });
    }

    this._noble.discoverIncludedServices(
      this._peripheralAddress,
      this.uuid,
      serviceUuids
    );
  }

  discoverCharacteristics(characteristicUuids, callback) {
    if (!this.discoverPromise) {
      this.discoverPromise = new Promise((resolve, reject) => {
        this.once('characteristicsDiscover', (characteristics) => {
          resolve(characteristics);
          this.discoverPromise = null;
        });

        this._noble.discoverCharacteristics(
          this._peripheralAddress,
          this.uuid,
          characteristicUuids
        );
      });
    }

    return this.discoverPromise;
  }

  toString() {
    return JSON.stringify({
      uuid: this.uuid,
      name: this.name,
      type: this.type,
      includedServiceUuids: this.includedServiceUuids
    });
  }
}

module.exports = Service;
