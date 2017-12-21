const BluetoothHciSocket = require('bluetooth-hci-socket');
const Rx = require('rxjs/Rx');

class BluetoothHciSocketStream {

  constructor() {
    this.socket = new BluetoothHciSocket();
    this.source = new Rx.Subject();
    this.socket.on('data', (data) => {
      this.source.next({ event: 'data', payload: data });
    });
    this.socket.on('error', (error) => {
      this.source.next({ event: 'error', payload: error });
    });
  }
}

module.exports = BluetoothHciSocketStream;
