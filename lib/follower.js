'use strict';

const is = require('is-type-of');
const Base = require('tcp-base');
const Packet = require('./protocol/packet');
const Request = require('./protocol/request');
const Response = require('./protocol/response');
const empty = () => {};

class Follower extends Base {
  /**
   * "Fake" Client, forward request to leader
   *
   * @param {Object} options
   *  - {Number} port - the port
   *  - {Map} descriptors - interface descriptors
   *  - {Transcode} transcode - serialze / deserialze methods
   *  - {Number} responseTimeout - the timeout
   * @constructor
   */
  constructor(options) {
    // local address
    options.host = '127.0.0.1';
    super(options);
    this._publishMethodName = this._findMethodName('publish');
    this._subInfo = new Map();
    this._subData = new Map();
    this._transcode = options.transcode;

    this.on('request', req => this._handleRequest(req));
    // avoid warning message
    this.setMaxListeners(100);

    // register to proper channel, difference type of client into difference channel
    this._registerChannel();
  }

  get isLeader() {
    return false;
  }

  get logger() {
    return this.options.logger;
  }

  get heartBeatPacket() {
    const heartbeat = new Request({
      connObj: {
        type: 'heartbeat',
      },
      timeout: this.options.responseTimeout,
    });
    return heartbeat.encode();
  }

  getHeader() {
    return this.read(24);
  }

  getBodyLength(header) {
    return header.readInt32BE(16) + header.readInt32BE(20);
  }

  decode(body, header) {
    const buf = Buffer.concat([ header, body ]);
    const packet = Packet.decode(buf);
    const connObj = packet.connObj;
    if (connObj && connObj.type === 'invoke_result') {
      if (connObj.success) {
        let data;
        if (packet.data) {
          data = this.options.transcode.decode(packet.data);
        }
        return {
          id: packet.id,
          isResponse: packet.isResponse,
          data,
        };
      }
      const error = new Error(connObj.message);
      if (connObj.stack) {
        error.stack = connObj.stack;
      }
      return {
        id: packet.id,
        isResponse: packet.isResponse,
        error,
      };
    }
    return {
      id: packet.id,
      isResponse: packet.isResponse,
      connObj: packet.connObj,
      data: packet.data,
    };
  }

  subscribe(reg, listener) {
    const key = this.options.formatKey(reg);
    this.on(key, listener);

    // no need duplicate subscribe
    if (!this._subInfo.has(key)) {
      this.logger.info('[Follower#%s] subscribe %j for first time', this.options.name, reg);
      const req = new Request({
        connObj: {
          type: 'subscribe',
          key,
          reg,
        },
        timeout: this.options.responseTimeout,
      });

      // send subscription
      this.send({
        id: req.id,
        oneway: true,
        data: req.encode(),
      });
      this._subInfo.set(key, true);
    } else if (this._subData.has(key)) {
      this.logger.info('[Follower#%s] subscribe %j', this.options.name, reg);
      listener(this._subData.get(key));
    }
    return this;
  }

  publish(reg) {
    this.invoke(this._publishMethodName, [ reg ]);
    return this;
  }

  invoke(method, args, callback) {
    const oneway = !is.function(callback); // if no callback, means oneway
    const req = new Request({
      connObj: {
        type: 'invoke',
        method,
        args,
        oneway,
      },
      timeout: this.options.responseTimeout,
    });

    // send invoke request
    this.send({
      id: req.id,
      oneway,
      data: req.encode(),
    }, callback);
  }

  _connect(done) {
    done = done || empty;
    return super._connect(done);
  }

  _registerChannel() {
    // make sure socket exists
    if (!this._socket) {
      return;
    }

    const req = new Request({
      connObj: {
        type: 'register_channel',
        channelName: this.options.name,
      },
      timeout: this.options.responseTimeout,
    });

    // send invoke request
    this.send({
      id: req.id,
      oneway: false,
      data: req.encode(),
    }, err => {
      if (err) {
        // if exception, retry after 5s
        setTimeout(() => this._registerChannel(), 5000);
        return;
      }
      this.logger.info('[Follower#%s] register to channel: %s success', this.options.name, this.options.name);
      this.ready(true);
    });
  }

  _findMethodName(type) {
    for (const method of this.options.descriptors.keys()) {
      const descriptor = this.options.descriptors.get(method);
      if (descriptor.type === 'delegate' && descriptor.to === type) {
        return method;
      }
    }
    return null;
  }

  _handleRequest(req) {
    this.logger.debug('[Follower#%s] receive req: %j from leader', this.options.name, req);
    const connObj = req.connObj || {};
    if (connObj.type === 'subscribe_result') {
      const result = this._transcode.decode(req.data);
      this.emit(connObj.key, result);
      this._subData.set(connObj.key, result);
      // feedback
      const res = new Response({
        id: req.id,
        timeout: req.timeout,
        connObj: { type: 'subscribe_result_res' },
      });
      this.send({
        id: req.id,
        oneway: true,
        data: res.encode(),
      });
    }
  }
}

module.exports = Follower;