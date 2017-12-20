const NobleFactory = require('../index');

const noble = NobleFactory(0, true);

noble.on('stateChange', (state) => {
  if (state === 'poweredOn') {
    noble.startScanning([], true);
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', (peripheral) => {
  console.log('peripheral discovered (' + peripheral.id +
              ' with address <' + peripheral.address +  ', ' + peripheral.addressType + '>,' +
              ' connectable ' + peripheral.connectable + ',' +
              ' RSSI ' + peripheral.rssi + ':');
  console.log('\tname is: ' + peripheral.advertisement.localName);
  console.log('\t\t' + JSON.stringify(peripheral.advertisement.serviceUuids));

  const { advertisement: { serviceData, manufacturerData, txPowerLevel } } = peripheral;
  if (serviceData && serviceData.length) {
    console.log('\there is my service data:');
    for (const service of serviceData) {
      console.log('\t\t' + JSON.stringify(service.uuid) + ': ' + JSON.stringify(service.data.toString('hex')));
    }
  }
  if (manufacturerData) {
    console.log('\there is my manufacturer data: ' + JSON.stringify(manufacturerData.toString('hex')));
  }
  if (txPowerLevel) {
    console.log('\tmy TX power level is: ' + txPowerLevel);
  }

  console.log();
});

