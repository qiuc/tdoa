/**
 * Created by chenqiu on 15/8/24.
 */

var deviceFactory   = require('./deviceFactory');
var Protocol        = require('./protocol/Protocol');
var dgram           = require('dgram');
var EventEmitter    = require("events").EventEmitter;
var Util            = require("util");

module.exports = Task;
Util.inherits(Task, EventEmitter);
function Task(options) {
    EventEmitter.call(this);

    this.config = options.config;

    this._socket        = null;
    this._protocol      = new Protocol({config: this.config, task: this});
    this._anchorCluster = deviceFactory.createAnchorCluster(options.anchorClusterOptions || {});
    this._tagCluster    = deviceFactory.createTagCluster(options.tagClusterOptions || {}, this._anchorCluster);
    this.state          = 'idle';
}

function bindToCurrentDomain(callback) {
    if(!callback) return;

    var domain = process.domain;

    return domain
        ? domain.bind(callback)
        : callback;
}

Task.prototype.run = function (options, callback) {
    if(!callback && typeof options === 'function') {
        callback = options;
        options = {};
    }

    if(this.state === 'idle') {

        this._socket = dgram.createSocket("udp4");

        var task = this;

        this._protocol.on('data', function(data, rinfo) {
            task._socket.send(data, 0, data.length, rinfo.port, rinfo.address);
        });

        this._socket.on('message', function (msg, rinfo) {
            task._protocol.write(msg, rinfo);
        });

        this._socket.on('error', this._handleNetworkError.bind(this));
        this._socket.on('listening', this._handleProtocolListening.bind(this));

        this._socket.bind(this.config.port);

        this._protocol.on('error', this._handleProtocolError.bind(this));
        this._protocol.on('packet', this._handleProtocolPacket.bind(this));

        this._protocol.run();

        this._anchorCluster.on('error', this._handleAnchorError.bind(this));
        this._anchorCluster.on('position', this._handleAnchorPosition.bind(this));

        this._tagCluster.run({});

        process.nextTick(function() {
            callback(task._anchorCluster);
        });
    }
};

Task.prototype.stop = function() {
    this.state = 'idle';
    this._socket.close();
    this._protocol.stop();
};

Task.prototype.pause = function() {
    this._protocol.pause();
};

Task.prototype.resume = function() {
    this._protocol.resume();
};

Task.prototype._handleNetworkError = function(err) {
    this.state = 'idle';
    this._socket.close();
    this._protocol.handleNetworkError(err);
    this.emit('error', err);
};

Task.prototype._handleProtocolError = function(err) {
    this.emit('error', err);
};

Task.prototype._handleProtocolListening = function() {
    this.state = "listening";
    var address = this._socket.address();
    this.emit('listening', address);
};

Task.prototype._handleProtocolPacket = function(packet) {
    this.emit('packet', packet);

    switch(packet.payload.name) {
        case "Tof Report":
            if(this._anchorCluster.isPositioned(packet.header.anchorId)) {
                this._tagCluster.processTofReport(packet.header.anchorId, packet.payload);
            }
            break;
    }
};

Task.prototype._handleAnchorPosition = function (positions) {
    this.emit('anchor_position', positions);
};

Task.prototype._handleAnchorError = function (err) {
    this.emit('error', err);
};