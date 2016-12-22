'use strict';

const is = require('is-type-of');
const Base = require('sdk-base');
const Packet = require('./protocol/packet');
const Response = require('./protocol/response');

class Connection extends Base {
  /**
   * Socket Connection among Leader and Follower
   *
   * @param {Object} options
   *  - {Socket} socket - the socket instance
   *  - {Number} responseTimeout - the response timeout
   *  - {Transcode} transcode - serialze / deserialze methods
   * @constructor
   */
  constructor(options) {
    super();
    this._options = options;
    this._socket = options.socket;
    this._invokes = new Map();
    this.key = this._socket.remotePort;
    this._lastActiveTime = Date.now();
    this._transcode = options.transcode;

    // listen socket events
    this._socket.on('readable', () => this._onReadable());
    this._socket.on('error', err => this.close(err));
    this._socket.on('close', () => this.close());

    // try read data from buffer at first
    this._onReadable();
  }

  get isOk() {
    return this._socket && this._socket.writable;
  }

  get lastActiveTime() {
    return this._lastActiveTime;
  }

  set lastActiveTime(val) {
    this._lastActiveTime = val;
  }

  /**
   * send packet
   *
   * @param {Packet} packet - the packet
   * @param {Function} [callback] - callback function
   * @return {void}
   */
  send(packet, callback) {
    this._write(packet.encode());
    if (!packet.isResponse) {
      const id = packet.id;
      const timeout = packet.timeout;
      this._invokes.set(id, {
        id,
        timer: setTimeout(() => {
          callback(new Error(`[ClusterClient] no response in ${timeout}ms, remotePort#${this.key}`), timeout);
          this._invokes.delete(id);
        }, timeout),
        callback,
      });
    }
  }

  close(err) {
    if (!this._socket) {
      return;
    }

    this._socket.destroy();
    this._socket.removeAllListeners();
    this._socket = null;

    if (err) {
      this.emit('error', err);
    }

    this.emit('close');
    this.removeAllListeners();
  }

  _onReadable() {
    try {
      let remaining = false;
      do {
        remaining = this._readPacket();
      }
      while (remaining);
    } catch (err) {
      this.close(err);
    }
  }

  _read(n) {
    return this._socket.read(n);
  }

  _write(bytes) {
    if (!this.isOk) {
      return false;
    }
    return this._socket.write(bytes);
  }

  _getHeader() {
    return this._read(24);
  }

  _getBodyLength(header) {
    return header.readInt32BE(16) + header.readInt32BE(20);
  }

  _readPacket() {
    if (is.nullOrUndefined(this._bodyLength)) {
      this._header = this._getHeader();
      if (!this._header) {
        return false;
      }
      this._bodyLength = this._getBodyLength(this._header);
    }

    let body;
    // body may be emtry
    if (this._bodyLength > 0) {
      body = this._read(this._bodyLength);
      if (!body) {
        return false;
      }
    }
    this._bodyLength = null;
    const packet = Packet.decode(Buffer.concat([ this._header, body ]));
    const id = packet.id;

    if (packet.isResponse) {
      const info = this._invokes.get(id);
      if (info) {
        clearTimeout(info.timer);
        info.callback(null, packet.data);
        this._invokes.delete(id);
      }
    } else {
      process.nextTick(() => this.emit('request', packet, new Response({
        id,
        timeout: packet.timeout,
      })));
    }
    return true;
  }
}

module.exports = Connection;