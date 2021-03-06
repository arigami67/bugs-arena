var io = require('socket.io-client');
var Qstore = require('qstore');
var express = require('express');
var bodyParser = require('body-parser');
var Entities = require('html-entities').AllHtmlEntities;
var entities = new Entities();
var log = console.log;

var PORT = 8095;
var HOSTS_REFRESH_INTERVAL = 1000;
var HOST_TIMEOUT = 6000;

function LobbyServer () {
	this.init.apply(this, arguments);
}

LobbyServer.prototype = {

	init: function (PORT) {
		this.port = PORT;
		this.webServer = express();
		this.webServer.use(bodyParser());
		this.hosts = new Qstore();
		this.webServer.get('/', this._onRequest.bind(this));
		this.webServer.post('/', this._onCandidate.bind(this));
	},

	start: function () {
		this.webServer.listen(this.port);
		log('lobby server started on port ', this.port);
		setInterval(this.refresh.bind(this), HOSTS_REFRESH_INTERVAL);
	},

	refresh: function () {
		this.hosts.sort('id');
		var now = new Date();
		var removedCnt = this.hosts.remove(function (host) {
			if (now.valueOf() - host.lastSync.valueOf() >= HOST_TIMEOUT) {
				log('remove host ' + host.id + ' by timeout');
				return true;
			}
		});
		if (removedCnt) log('total active hosts: ', this.hosts.rows.length);
	},

	checkHost: function (candidate) {
		log('check host ', candidate);
		var socket = io.connect('http://' + candidate.ip + ':' + candidate.port, {'force new connection': true});

		socket.on('connect', function () {
			socket.disconnect();
			candidate.lastSync = new Date();
			this.hosts.remove({id: candidate.id});
			this.hosts.add(candidate);
			log('host ' + candidate.id + ' was checked');
			log('total active hosts: ', this.hosts.rows.length);
		}.bind(this));

		socket.on('error', function () {
			log('could not check ' + candidate.id);
		}.bind(this));
	},

	jsonpResponse: function (res, data) {
		res.send(res.req.query.callback + '(' + JSON.stringify(data) + ')');
	},

	_onRequest: function (req, res) {
		this.jsonpResponse(res, this.hosts.pack(true, ['name', 'id', 'ip', 'port', 'playersCnt', 'map', 'protocol']));
	},

	_onCandidate: function (req, res) {
		var p = req.body;

		var candidate = {
			id: req.ip + ':' + entities.encode(p.port),
			ip: req.ip,
			port: entities.encode(p.port),
			name: entities.encode(p.name),
			protocol: entities.encode(p.protocol),
			playersCnt: Number(p.playersCnt),
			map: entities.encode(p.map),
			lastSync: new Date()
		};

		if (!candidate.port) {
			res.send({error: 'wrong request'});
			return;
		};

		if (this.hosts.findOne({id: candidate.id})) {
			this.hosts.update({id: candidate.id}, candidate);
			res.send({status: 'updated'});
		} else {
			this.checkHost(candidate);
			res.send({status: 'new'});
		}
	}
}


var lobbyServer = new LobbyServer(PORT);
lobbyServer.start();