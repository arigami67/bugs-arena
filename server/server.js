var io = require('socket.io');

var PORT = 8089;
var PROTOCOL_VERSION = 1;
var MAX_CLIENTS = 4;
var TICK_DELAY = 25;
var SEND_DELAY = 5;
var START_GAME_DELAY = 50;
var log = console.log;

var utils = {
	length: function (obj) {
		var i = 0;
		for (var key in obj) i++;
		return i;
	}
}

var Client = function (id, socket) {
	this.id = id;
	this.socket = socket;
	this.team = null;
	this.isConnected = true;
	this.isReady = false;
	this.isActive = true;
	this.name = true;
}

Client.prototype = {
	send: function (msg, data) {
		var dataToSend = {msg: msg, data: data}
		this.socket.emit('message', dataToSend);
	}
}

var GameServer = function () {this.init();}

GameServer.prototype = {

	init: function () {
		this.clients = {};
		this.players = {
			blue: null,
			red: null,
			green: null,
			purple: null
		}
		this.lastId = 0;
		this.age = 0;
		this.lastAge = 0;
		this.events = [];
		this.frameEvents = [];
		this.gameIsRunning = false;
		this.gameIsOver = false;
		this.randomizer = null;
		this.clientsCnt = 0;
		this.startAge = 0;
		this.loopIntervalId = null;
	},

	start: function () {
		if (!this.io) {
			this.io = io.listen(PORT);
			this.io.sockets.on('connection', this._onConnection.bind(this));
			log('server started on port ' + PORT);
		}
		this.randomizer = Math.round(Math.random() * 10000000);
		this.loopIntervalId = setInterval(this.loop.bind(this), TICK_DELAY);
		log('server ready');
	},

	restart: function () {
		log('restarting...');
		clearInterval(this.loopIntervalId);
		this.init();
		this.start();
	},

	loop: function () {
		if (this.gameIsOver) {
			this.gameOver();
			return;
		}

		var clientsCnt = utils.length(this.clients);
		if (clientsCnt) this.age++;
		if (this.age && !(this.age % SEND_DELAY)) {
			this.sendState();
		}
	},

	gameOver: function () {
		log('game is over');
		for (var key in this.clients) {
			var client = this.clients[key];
			if (client.socket) {
				client.socket.disconnect();
			}
		}
		setTimeout(this.restart.bind(this));
	},

	sendState: function () {
		var data = {
			age: this.age,
			framesCnt: SEND_DELAY,
			events: this.events,
			frames: {}
		}

		this.gameStateCheck();

		for (var i = 0; i < this.frameEvents.length; i++) {
			var event = this.frameEvents[i];
			if (!data.frames[event.age]) data.frames[event.age] = [];
			data.frames[event.age].push(event);
		}
		for (var key in this.clients) {
			var client = this.clients[key];
			if (client.isConnected) client.send('state', data);
		}
		this.events = [];
		this.frameEvents = [];
		this.lastAge = this.age;
	},

	event: function (name, data) {
		this.events.push({name: name, data: data, age: this.age});
	},

	frameEvent: function (name, data, age) {
		age = age || this.lastAge + SEND_DELAY;
		this.frameEvents.push({name: name, data: data, age: age});
	},

	gameStateCheck: function () {

		var playersCnt = 0;
		var readyPlayersCnt = 0;
		var activePlayersCnt = 0;
		for (var key in this.players) {
			var player = this.players[key];
			if (!player) continue;
			playersCnt++;
			if (player && player.isReady) readyPlayersCnt++;
			if (player.isActive) activePlayersCnt++;
		}
		var allPlayersIsReady = playersCnt && (playersCnt == readyPlayersCnt);


		if (this.gameIsRunning) {
			if (activePlayersCnt < 2) {
				this.gameIsOver = true;
				this.event('gameOver');
			}
			return;
		}

		// prerare to start
		if (allPlayersIsReady && !this.startAge && playersCnt > 1) {
			this.startAge = this.age + START_GAME_DELAY;
			this.event('startAge', this.startAge);
		}

		// cancel start
		if (!allPlayersIsReady && this.startAge) {
			this.startAge = 0;
			this.event('startAge', this.startAge);
		}

		// start game
		if (this.startAge && this.age >= this.startAge) {
			this.gameIsRunning = true;
			this.event('start');
		}
	},

	disconnectClient: function (id) {
		var client = this.clients[id];
		if (!client) return;

		if (!this.gameIsRunning) {
			if (client.team) this.players[client.team] = null;
			delete this.clients[client.id];
		} else {
			client.isConnected = false;
		}
		this.clientsCnt--;
		this.event('playerDisconnected', client.id);
		log('client ' + client.id + ' disconnected');
		if (!this.clientsCnt && this.gameIsRunning) this.gameOver();
	},

	_onConnection: function (socket) {
		var disconnectMsg = '';
		if (this.clientsCnt == MAX_CLIENTS) disconnectMsg = 'server is full';
		if (this.gameIsRunning) disconnectMsg = 'game already is running';
		if (disconnectMsg) {
			socket.emit('message', {msg: 'disconnect', data: disconnectMsg});
			socket.disconnect();
			return;
		}

		var id = ++this.lastId;
		var client = new Client(id, socket);
		this.clients[id] = client;
		this.clientsCnt++;
		socket.on('message', function (data) {
			this._onMessage(client, data);
		}.bind(this));
		socket.on('disconnect', this._onDisconnect.bind(this, client));
		log('new connection, id = ' + id);
	},

	_onMessage: function (client, data) {
		log('client ' + client.id + ' say: ', data);
		if (data.msg != 'hello' && !this.clients[client.id]) {
			this.disconnectClient(client.id);
			return;
		}
		switch (data.msg) {
			case 'hello': this._onHello(client, data.data);break
			case 'target': this._onTarget(client, data.data);break;
			case 'ready': this._onPlayerReady(client);break;
			case 'waiting': this._onPlayerWaiting(client);break;
			case 'chatMessage': this._onChatMessage(client, data.data);break;
			case 'loose': this._onPlayerLoose(client);break;
		}
	},

	_onPlayerLoose: function (client) {
		client.isActive = false;
	},

	_onChatMessage: function (client, msg) {
		this.event('chatMessage', {player: client.id, msg: msg});
	},

	_onTarget: function (client, data) {
		this.frameEvent('target', {
			x: data.x,
			y: data.y,
			team: client.team
		})
	},

	_onPlayerReady: function (client) {
		client.isReady = true;
		this.event('playerReady', client.id);
	},

	_onPlayerWaiting: function (client) {
		client.isReady = false;
		this.event('playerWaiting', client.id);
	},

	_onHello: function (client, data) {
		client.name = data.name;
		if (data.protocol != PROTOCOL_VERSION) {
			client.send('disconnect', 'Wrong protocol. Server version - ' + PROTOCOL_VERSION + ', client version - ' + data.protocol);
			this.disconnectClient(client.id);
			return;
		}
		var currentTeam = null;
		for (var team in this.players) {
			var player = this.players[team];
			if (player) continue;
			currentTeam = team;
			break;
		}

		if (currentTeam) {
			client.team = currentTeam;
			this.players[currentTeam] = client;
		}
		var players = {};
		for (var team in this.players) {
			var player = this.players[team];
			if (!player) continue;
			players[team] = {
				id: player.id,
				name: player.name,
				team: team,
				isReady: player.isReady
			}
		}

		client.send('hello', {
			id: client.id,
			team: currentTeam,
			players: players,
			age: this.age,
			randomizer: this.randomizer
		});

		for (var clientId in this.clients) {
			if (clientId == client.id) continue;
			this.clients[clientId].send('newPlayer', {
				id: client.id,
				name:client.name,
				team: client.team,
				age: this.age,
				isReady: client.isReady
			})
		}
	},

	_onDisconnect: function (client) {
		this.disconnectClient(client.id);
	}
}

var server = new GameServer();
server.start();