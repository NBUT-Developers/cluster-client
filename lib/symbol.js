'use strict';

exports.init = Symbol.for('ClusterClient#init');
exports.logger = Symbol.for('ClusterClient#logger');
exports.isReady = Symbol.for('ClusterClient#isReady');
exports.innerClient = Symbol.for('ClusterClient#innerClient');
exports.subscribe = Symbol.for('ClusterClient#subscribe');
exports.publish = Symbol.for('ClusterClient#publish');
exports.invoke = Symbol.for('ClusterClient#invoke');
exports.subInfo = Symbol.for('ClusterClient#subInfo');
exports.pubInfo = Symbol.for('ClusterClient#pubInfo');