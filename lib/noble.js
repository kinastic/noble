const debug = require('debug')('noble');

const events = require('events');
const util = require('util');

const Peripheral = require('./peripheral');

class Noble extends events.EventEmitter {
  constructor(bindings) {
    super();
    this.initialized = false;

    this.address = 'unknown';
    this._state = 'unknown';
    this._bindings = bindings;
    this._peripherals = {};
    this._discoveredPeripheralUUids = [];

    this._bindings.on('stateChange', this.onStateChange.bind(this));
    this._bindings.on('addressChange', this.onAddressChange.bind(this));
    this._bindings.on('scanStart', this.onScanStart.bind(this));
    this._bindings.on('scanStop', this.onScanStop.bind(this));
    this._bindings.on('discover', this.onDiscover.bind(this));
    // this._bindings.on('connect', this.onConnect.bind(this));
    // this._bindings.on('disconnect', this.onDisconnect.bind(this));
    // this._bindings.on('rssiUpdate', this.onRssiUpdate.bind(this));
    // this._bindings.on('includedServicesDiscover', this.onIncludedServicesDiscover.bind(this));
    // this._bindings.on('read', this.onRead.bind(this));
    // this._bindings.on('write', this.onWrite.bind(this));
    // this._bindings.on('broadcast', this.onBroadcast.bind(this));
    // this._bindings.on('notify', this.onNotify.bind(this));
    // this._bindings.on('valueRead', this.onValueRead.bind(this));
    // this._bindings.on('valueWrite', this.onValueWrite.bind(this));
    // this._bindings.on('handleRead', this.onHandleRead.bind(this));
    // this._bindings.on('handleWrite', this.onHandleWrite.bind(this));

    this.on('warning', message => {
      if (this.listeners('warning').length === 1) {
        console.warn('noble: ' + message);
      }
    });
  }

  init() {
    if (!this.initialized) {
      this._bindings.init();
      this.initialized = true;
    }
  }

  get state() {
    return this._state;
  }

  onStateChange(state) {
    debug('stateChange ' + state);

    this._state = state;

    this.emit('stateChange', state);
  }

  onAddressChange(address) {
    debug('addressChange ' + address);

    this.address = address;
  }

  startScanning(serviceUuids, allowDuplicates) {
    return new Promise((resolve, reject) => {
      if (this._state !== 'poweredOn') {
        reject(new Error('Could not start scanning, state is ' + this._state  + ' (not poweredOn)'));
      } else {
        this.once('scanStart', (filterDuplicates) => {
          resolve(filterDuplicates);
        });

        this._discoveredPeripheralUUids = [];
        this._allowDuplicates = allowDuplicates;

        this._bindings.startScanning(serviceUuids, allowDuplicates);
      }
    })
  }

  onScanStart(filterDuplicates) {
    debug('scanStart');
    this.emit('scanStart', filterDuplicates);
  }

  stopScanning() {
    return new Promise((resolve, reject) => {
      this.once('scanStop', () => {
        resolve();
      });
      this._bindings.stopScanning();
    });
  }

  onScanStop() {
    debug('scanStop');
    this.emit('scanStop');
  }

  onDiscover(address, addressType, connectable, advertisement, rssi) {
    let peripheral = this._peripherals[address];

    if (!peripheral) {
      peripheral = new Peripheral(
        this,
        address,
        addressType,
        connectable,
        advertisement,
        rssi,
      );

      this._peripherals[address] = peripheral;
    } else {
      // "or" the advertisment data with existing
      const keys = Object.keys(advertisement);
      for (const key of keys) {
        if (advertisement[key]) {
          peripheral.advertisement[key] = advertisement[key];
        }
      }

      peripheral.rssi = rssi;
    }

    const previouslyDiscoverd = this._discoveredPeripheralUUids.indexOf(address) !== -1;

    if (!previouslyDiscoverd) {
      this._discoveredPeripheralUUids.push(address);
    }

    if (this._allowDuplicates || !previouslyDiscoverd) {
      this.emit('discover', peripheral);
    }
  }

  connectGatt(peripheralUuid) {
    return this._bindings.connectGatt(peripheralUuid);
  }
}
module.exports = Noble;
