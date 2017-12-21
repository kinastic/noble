
class CommandResolver {

  constructor(resolve, reject, timeout = 0) {
    this._resolve = resolve;
    this._reject = reject;
    if (timeout > 0) {
      setTimeout(() => {
        this.reject(new Error('timeout'));
      }, timeout);
    }
  }

  resolve(data) {
    this._resolve(data);
  }

  reject(err) {
    this._reject(err);
  }
}

module.exports = CommandResolver;
