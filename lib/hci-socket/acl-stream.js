const debug = require('debug')('acl-att-stream');

const Rx = require('rxjs/Rx');

const Smp = require('./smp');

class AclStream {
  constructor(hci, handle, remoteAddressType, remoteAddress) {
    this.source = new Rx.Subject();
    this._hci = hci;
    this._handle = handle;

    this.hciSubscription = this._hci.source
      .filter(({ event }) => event === 'disconnComplete' || event === 'aclDataPkt' || event === 'onEcryptChange')
      .filter(({ payload: { handle }}) => handle === this._handle)
      .subscribe(({ event, payload }) => {
        this.handleHciEvent(event, payload);
      });

    this._smp = new Smp(this, hci.addressType, hci.address, remoteAddressType, remoteAddress);
    this.smpSubscription = this._smp.source.subscribe(({ event, payload }) => {
      this.handleSmpEvent(event, payload);
    })
  }

  handleHciEvent(event, payload) {
    switch (event) {
      case 'aclDataPkt': this.onAclDataPkt(payload);
        break;
      case 'disconnComplete': this.onDisconnComplete(payload);
        break;
      // case 'encryptChange': this.onEcryptChange(payload);
    }
  }

  handleSmpEvent(event, payload) {
    switch (event) {
      case 'stk': this.onSmpStk(payload);
        break;
      case 'fail': this.onSmpFail(payload);
        break;
      case 'end': this.onSmpEnd(payload);
        break;
    }
  }

  onAclDataPkt({ handle, cid, data }) {
    if (data) {
      this.source.next({ event: 'data', payload: { cid, data } });
    } else {
      this.source.next({ event: 'end' });
    }
  }

  onDisconnComplete() {
    this.source.next({ event: 'end' });
  }

  onEncryptChange({ handle, encrypt }) {
    this.source.next({ event: 'encrypt', payload: { encrypt } });
  }

  encrypt() {
    this._smp.sendPairingRequest();
  }

  write(cid, data) {
    this._hci.writeAclDataPkt(this._handle, cid, data);
  }

  onSmpStk({ stk }) {
    const random = new Buffer('0000000000000000', 'hex');
    const diversifier = new Buffer('0000', 'hex');

    this._hci.startLeEncryption(this._handle, random, diversifier, stk);
  }

  onSmpFail() {
    // TODO test
    this.source.next({ event: 'encryptFail' });
    // this.emit('encryptFail');
  }

  onSmpEnd() {
    this.smpSubscription.unsubscribe();
  }
}

module.exports = AclStream;
