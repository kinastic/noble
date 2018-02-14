const async = require('async');
const NobleFactory = require('../index');

const noble = NobleFactory(0, false);
noble.init();

// const addresses = ['cd:89:6c:f6:86:47', 'e7:fe:e0:76:fa:c1', 'e8:3b:b5:33:3c:4c', 'e8:b9:1a:26:5b:3a']; // 000026
const addresses = ['cd:89:6c:f6:86:47']; // 000026
// const peripheralIdOrAddress = 'fa:df:6d:8d:87:fe'; // 000103
// const address = 'e7:fe:e0:76:fa:c1'; // 000110
// e8:3b:b5:33:3c:4c // 000112
// e8:b9:1a:26:5b:3a // 000104
const found = [];

noble.on('stateChange', (state) => {
  if (state === 'poweredOn') {
    noble.startScanning([], true);
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', async (peripheral) => {
  if (found.length !== addresses.length && addresses.findIndex(a => a === peripheral.address) !== -1
    && found.findIndex(p => p.address === peripheral.address) === -1) {
    found.push(peripheral);
  } else if(found.length === addresses.length) {
    await noble.stopScanning();

    for (const peripheral of found) {
      console.log('peripheral with ID ' + peripheral.address + ' found');
      const advertisement = peripheral.advertisement;

      const localName = advertisement.localName;
      const txPowerLevel = advertisement.txPowerLevel;
      const manufacturerData = advertisement.manufacturerData;
      const serviceData = advertisement.serviceData;
      const serviceUuids = advertisement.serviceUuids;

      if (localName) {
        console.log('  Local Name        = ' + localName);
      }

      if (txPowerLevel) {
        console.log('  TX Power Level    = ' + txPowerLevel);
      }

      if (manufacturerData) {
        console.log('  Manufacturer Data = ' + manufacturerData.toString('hex'));
      }

      if (serviceData) {
        console.log('  Service Data      = ' + serviceData);
      }

      if (serviceUuids) {
        console.log('  Service UUIDs     = ' + serviceUuids);
      }

      console.log();

      startExploring(peripheral);
    }
  }
});

const startExploring = (peripheral) => {
  peripheral.source.subscribe(({ event, payload }) => {
    if (event === 'disconnect') {
      setTimeout(() => {
        explore(peripheral);
      }, 500);
    }
  });
  explore(peripheral);
};

const explore = async (peripheral) => {
  console.log('services and characteristics:');

  try {
    await peripheral.connect();
    console.log('Connected to: ' + peripheral.address);
    const services = await peripheral.discoverServices(['f0000001de94078fe31135b1ee4fdb15']);

    let chara = null;

    for (const service of services) {
      let serviceInfo = service.uuid;

      if (service.name) {
        serviceInfo += ' (' + service.name + ')';
      }
      console.log(serviceInfo);

      const characteristics = await service.discoverCharacteristics([]);

      for (const characteristic of characteristics) {
        let characteristicInfo = '  ' + characteristic.uuid;

        if (characteristic.uuid === 'f0000003de94078fe31135b1ee4fdb15') {
          chara = characteristic;
        }

        if (characteristic.name) {
          characteristicInfo += ' (' + characteristic.name + ')';
        }

        characteristicInfo += '\n    properties  ' + characteristic.properties.join(', ');

        if (characteristic.properties.indexOf('read') !== -1) {
          try {
            const data = await characteristic.read();
            if (data) {
              const string = data.toString('ascii');

              characteristicInfo += '\n    value       ' + data.toString('hex') + ' | \'' + string + '\'';
            }
          } catch (err) {

          }
        }
        console.log(characteristicInfo);
      }
    }
    if (chara) {
      const subscription = chara.source.subscribe(({ payload }) => {
        console.log(payload);
      });
      await chara.subscribe();

      // setTimeout(async () => {
      //   subscription.unsubscribe();
      //   await peripheral.disconnect();
      // }, 2000);
    }
  } catch (err) {
    console.error(err);
    peripheral.disconnect();
  }
};

