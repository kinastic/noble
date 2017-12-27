const debug = require('debug')('characteristic');

const events = require('events');
const util = require('util');
const Descriptor = require('./descriptor');
const Rx = require('rxjs/Rx');

const characteristics = require('./characteristics.json');

class Characteristic {
  constructor(gatt, peripheralAddress, serviceUuid, uuid, properties, valueHandle) {
    this.source = new Rx.Subject();
    this._peripheralAddress = peripheralAddress;
    this._serviceUuid = serviceUuid;

    this.uuid = uuid;
    this.name = null;
    this.type = null;
    this.valueHandle = valueHandle;
    this.properties = properties;
    this.descriptors = null;

    const characteristic = characteristics[uuid];
    if (characteristic) {
      this.name = characteristic.name;
      this.type = characteristic.type;
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
    this.notifyPromise = null;
    this.notifyResolve = null;
  }

  setGatt(gatt) {
    if (this.gatt !== gatt) {
      if (this.gattSubscription) {
        this.gattSubscription.unsubscribe();
      }
      this.gatt = gatt;
      this.gattSubscription = this.gatt.source
      // .filter(({ event }) => event === 'descriptorsDiscover' || event === 'notify')
        .subscribe(({ event, payload }) => {
          this.handleGattEvent(event, payload);
        });
    }
  }

  handleGattEvent(event, payload) {
    switch (event) {
      case 'descriptorsDiscover': this.onDescriptorsDiscovered(payload);
        break;
      case 'notify': this.onNotify(payload);
        break;
      case 'read': this.onRead(payload);
        break;
      case 'notification': this.onNotification(payload);
        break;
    }
  }

  read() {
    if (!this.readPromise) {
      this.readPromise = new Promise((resolve, reject) => {
        this.readResolve = resolve;
        this.gatt.read(
          this._serviceUuid,
          this.uuid
        );
      });
    }
    return this.readPromise;
  }

  write(data, withoutResponse, callback) {
    if (process.title !== 'browser') {
      if (!(data instanceof Buffer)) {
        throw new Error('data must be a Buffer');
      }
    }

    if (callback) {
      this.once('write', function() {
        callback(null);
      });
    }

    this.gatt.write(
      this._peripheralAddress,
      this._serviceUuid,
      this.uuid,
      data,
      withoutResponse
    );
  }

  broadcast(broadcast, callback) {
    if (callback) {
      this.once('broadcast', function() {
        callback(null);
      });
    }

    this.gatt.broadcast(
      this._peripheralAddress,
      this._serviceUuid,
      this.uuid,
      broadcast
    );
  }

  notify(notify) {
    if (notify) {
      if (!this.notifyPromise) {
        this.notifyPromise = new Promise((resolve, reject) => {
          this.notifyResolve = resolve;
          this.gatt.notify(
            this._serviceUuid,
            this.uuid,
            notify
          );
        })
      }
      return this.notifyPromise;
    } else {
      this.gatt.notify(
        this._serviceUuid,
        this.uuid,
        notify
      );
      return Promise.resolve();
    }
  }

  subscribe() {
    return this.notify(true);
  }

  unsubscribe() {
    return this.notify(false);
  }

  discoverDescriptors() {
    if (!this.discoverPromise) {
      this.discoverPromise = new Promise((resolve, reject) => {
        this.discoverResolve = resolve;
        this.discoverReject = reject;
        this.gatt.discoverDescriptors(
          this._peripheralAddress,
          this._serviceUuid,
          this.uuid
        );
      });
    }
    return this.discoverPromise;
  }

  onDescriptorsDiscovered({ address, serviceUuid, characteristicUuid, descriptorUuids }) {
    if (this._peripheralAddress === address && this._serviceUuid === serviceUuid && this.uuid === characteristicUuid) {
      this.descriptors = descriptorUuids.map((uuid) => (
        new Descriptor(
          this.gatt,
          address,
          serviceUuid,
          characteristicUuid,
          uuid,
        )
      ));

      if (this.discoverResolve) {
        this.discoverResolve(this.descriptors);
      }
      this.discoverReject = null;
      this.discoverResolve = null;
      this.discoverPromise = null;
    }
  }

  onNotify({ address, serviceUuid, characteristicUuid, state }) {
    if (this._peripheralAddress === address && this._serviceUuid === serviceUuid && this.uuid === characteristicUuid) {
      if (this.notifyResolve) {
        this.notifyResolve();
      }
      this.notifyResolve = null;
      this.notifyPromise = null;
    }
  }

  onRead({ address, serviceUuid, characteristicUuid, readData }) {
    if (this._peripheralAddress === address && this._serviceUuid === serviceUuid && this.uuid === characteristicUuid) {
      if (this.readResolve) {
        this.readResolve(readData);
      }

      this.readResolve = null;
      this.readPromise = null;
    }
  }

  onNotification({ address, serviceUuid, characteristicUuid, valueHandle, valueData }) {
    if (this._peripheralAddress === address && this._serviceUuid === serviceUuid && this.uuid === characteristicUuid) {
      this.source.next({ event: 'data', payload: valueData });
    }
  }

  toString() {
    return JSON.stringify({
      uuid: this.uuid,
      name: this.name,
      type: this.type,
      properties: this.properties
    });
  }
}

module.exports = Characteristic;
