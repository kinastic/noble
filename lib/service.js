const debug = require('debug')('service');

const Characteristic = require('./characteristic');
const services = require('./services.json');

class Service {
  constructor(gatt, peripheralAddress, uuid) {
    this.gatt = gatt;
    this._peripheralAddress = peripheralAddress;

    this.uuid = uuid;
    this.name = null;
    this.type = null;
    this.includedServiceUuids = null;
    this.characteristics = [];

    const service = services[uuid];
    if (service) {
      this.name = service.name;
      this.type = service.type;
    }

    this.gatt.source
      .filter(({ event }) => event === 'characteristicsDiscover')
      .subscribe(({ event, payload }) => {
        this.onCharacteristicsDiscovered(payload);
      });
  }

  // discoverIncludedServices(serviceUuids, callback) {
  //   if (callback) {
  //     this.once('includedServicesDiscover', (includedServiceUuids) => {
  //       callback(null, includedServiceUuids);
  //     });
  //   }
  //
  //   this._noble.discoverIncludedServices(
  //     this._peripheralAddress,
  //     this.uuid,
  //     serviceUuids
  //   );
  // }

  discoverCharacteristics(characteristicUuids = []) {
    if (!this.discoverPromise) {
      this.discoverPromise = new Promise((resolve, reject) => {
        this.discoverResolve = resolve;
        this.gatt.discoverCharacteristics(this.uuid, characteristicUuids || []);
      });
    }

    return this.discoverPromise;
  }

  onCharacteristicsDiscovered({ address, serviceUuid, characteristics }) {
    if (this._peripheralAddress === address && this.uuid === serviceUuid) {
      characteristics
        .filter(({ uuid }) => -1 === this.characteristics.findIndex(c => c.uuid === uuid))
        .forEach(({ uuid, valueHandle, properties }) => {
          this.characteristics.push(
            new Characteristic(
              this.gatt,
              address,
              serviceUuid,
              uuid,
              properties,
              valueHandle,
            )
          );
        });
      if (this.discoverResolve) {
        this.discoverResolve(this.characteristics);
      }
      this.discoverPromise = null;
      this.discoverResolve = null;
    }
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
