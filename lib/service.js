const debug = require('debug')('service');

const Characteristic = require('./characteristic');
const services = require('./services.json');

class Service {
  constructor(gatt, peripheralAddress, uuid) {
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

    this.setGatt(gatt);
  }

  onDisconnect() {
    if (this.discoverReject) {
      this.discoverReject();
    }
    this.discoverReject = null;
    this.discoverPromise = null;
    this.discoverResolve = null;
    this.characteristics.forEach(c => c.onDisconnect());
  }

  setGatt(gatt) {
    if (this.gatt !== gatt) {
      if (this.gattSubscription) {
        this.gattSubscription.unsubscribe();
      }
      this.gatt = gatt;
      this.gattSubscription = this.gatt.source
        .filter(({ event }) => event === 'characteristicsDiscover')
        .subscribe(({ event, payload }) => {
          this.onCharacteristicsDiscovered(payload);
        });
    }
  }

  discoverCharacteristics(characteristicUuids = []) {
    if (!this.discoverPromise) {
      this.discoverPromise = new Promise((resolve, reject) => {
        this.discoverResolve = resolve;
        this.discoverReject = reject;
        this.gatt.discoverCharacteristics(this.uuid, characteristicUuids || []);
      });
    }

    return this.discoverPromise;
  }

  onCharacteristicsDiscovered({ address, serviceUuid, characteristics }) {
    if (this._peripheralAddress === address && this.uuid === serviceUuid) {
      for (const chara of characteristics) {
        const characteristic = this.characteristics.find(({ uuid }) => uuid === chara.uuid);
        if (characteristic) {
          characteristic.setGatt(this.gatt);
        } else {
          const { uuid, valueHandle, properties } = chara;
          this.characteristics.push(new Characteristic(
            this.gatt,
            this._peripheralAddress,
            this.uuid,
            uuid,
            properties,
            valueHandle,
          ));
        }
      }
      if (this.discoverResolve) {
        this.discoverResolve(this.characteristics);
      }
      this.discoverReject = null;
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
