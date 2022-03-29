function explode(delimiter, string, limit)
{
    // http://kevin.vanzonneveld.net
    // +     original by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
    // +     improved by: kenneth
    // +     improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
    // +     improved by: d3x
    // +     bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
    // *     example 1: explode(' ', 'Kevin van Zonneveld');
    // *     returns 1: {0: 'Kevin', 1: 'van', 2: 'Zonneveld'}
    // *     example 2: explode('=', 'a=bc=d', 2);
    // *     returns 2: ['a', 'bc=d']
    var emptyArray = {
        0: ''
    };

    // third argument is not required
    if (arguments.length < 2 || typeof arguments[0] == 'undefined' || typeof arguments[1] == 'undefined') {
        return null;
    }

    if (delimiter === '' || delimiter === false || delimiter === null) {
        return false;
    }

    if (typeof delimiter == 'function' || typeof delimiter == 'object' || typeof string == 'function' || typeof string == 'object') {
        return emptyArray;
    }

    if (delimiter === true) {
        delimiter = '1';
    }

    if (!limit) {
        return string.toString().split(delimiter.toString());
    } else {
        // support for limit argument
        var splitted = string.toString().split(delimiter.toString());
        var partA = splitted.splice(0, limit - 1);
        var partB = splitted.join(delimiter.toString());
        partA.push(partB);
        return partA;
    }
}

exports = module.exports = Service;

var net = require("net");
var util = require("util");
var events = require("events");

var Bot = require("./bot");
var User = require("./user");
var Channel = require("./channel");
var Origin = require("./origin");

function Service(protocol)
{
	if (!(this instanceof Service)) { return new Service(protocol); }
	events.EventEmitter.call(this);
	
	this._protocol = protocol;
	this._bots = [ ];
	this._users = [ ];
	this._channels = [ ];
	this._synced = false;
	this._defaultBot = undefined;
	protocol.serviceInit(this);
}
util.inherits(Service, events.EventEmitter);

Service.createService = function (protocol)
{
	return new Service(protocol);
}

Service.isService = function (obj)
{
	return typeof obj == 'object' && obj instanceof Service;
}

Service.prototype.connect = function (host, port, connected)
{
	var self = this;
	
	var s = self._socket = new net.Socket({type: "tcp4"});
	s.connect(port || 6667, host, function ()
	{
		self._protocol.logon();
		
		if (typeof connected == 'function')
		{
			connected();
		}
		
		var gbuf = "";
		s.on("data", function (data)
		{
			if (Buffer.isBuffer(data))
			{
				data = data.toString("utf8");
			}
			
			var buf = "";
			for (var i = 0; i < data.length; ++i)
			{
				if (data[i] == "\n")
				{
					var line = gbuf + buf;
					buf = "";
					gbuf = "";
					//console.log("line: '" + line + "'");
					
					var prefixed = line[0] == ":";
					var origin = null;
					var command = null;
					var paramsString = "";
					var params = [];
					
					var idx = line.indexOf(' ');
					if (idx == -1)
					{
						if (prefixed)
						{
							continue;
						}
						
						command = line;
					}
					else
					{
						if (prefixed)
						{
							line = line.substr(1);
							--idx;
							
							origin = line.substr(0, idx);
							command = line.substr(idx + 1);
							if ((idx = command.indexOf(' ')) != -1)
							{
								command = command.substr(0, idx);
								paramsString = line.substr(origin.length + command.length + 2);
							}
						}
						else
						{
							command = line.substr(0, idx);
							paramsString = line.substr(idx);
						}
					}
					
					var args = null;
					if (paramsString.length == 0)
					{
						args = [ ];
					}
					else if (paramsString[0] == ':')
					{
						args = [ paramsString.substr(1) ];
					}
					else
					{
						var parts = explode(' :', paramsString, 2);
						args = explode(' ', parts[0].trim());

						if (parts[1])
						{
							args.push(parts[1]);
						}
					}
					
					var originObj = new Origin(self);
					if (origin != null)
					{
						var idx = origin.indexOf('!');
						if (idx != -1)
						{
							originObj._nickname = origin.substr(0, idx);
							var rest = origin.substr(idx + 1);
							if ((idx = rest.indexOf('@')) != -1)
							{
								originObj._ident = rest.substr(0, idx);
								originObj._hostname = rest.substr(idx + 1);
							}
							else
							{
								originObj._ident = rest;
							}
						}
						else if ((idx = origin.indexOf('@')) != -1)
						{
							originObj._nickname = origin.substr(0, idx);
							originObj._hostname = origin.substr(idx + 1);
						}
						else
						{
							originObj._nickname = origin;
						}
					}
					
					self.emit('raw' + command.toUpperCase(), originObj, args, paramsString);
				}
				else if (data[i] != "\r")
				{
					buf += data[i];
				}
			}
			
			if (buf.length > 0)
			{
				gbuf += buf;
			}
		});
	});
}

Service.prototype.disconnect = function (reason)
{
	for (var i in this._bots)
	{
		this.deleteBot(this._bots[i], reason);
	}
	
	this._protocol.selfQuit(reason);
	this._socket.end();
}

Service.prototype.sendRaw = function (data)
{
	data = data.replace(/\r/g, '').replace(/\n/g, '');
	console.log("[OUT] " + data);
	return this._socket.write(data + "\r\n");
}

Service.prototype.createBot = function (nickname, ident, realname, hostname)
{
	var b = new Bot(this);
	b.logon(nickname, ident, realname, hostname);
	this._bots.push(b);
	
	// If this is the only bot, make it the default one
	if (this._bots.length == 1)
	{
		this._defaultBot = b;
	}
	
	return b;
}

Service.prototype.deleteBot = function (bot, reason)
{
	this._protocol.botQuit(bot, reason);
	delete this._bots[this._bots.indexOf(bot)];
	
	if (this._defaultBot == bot)
	{
		this._defaultBot = undefined;
	}
}

Service.prototype.findBot = function (nickname, ignoreCase)
{
	if (typeof ignoreCase == 'undefined' || !ignoreCase)
	{
		for (var i in this._bots)
		{
			if (this._bots[i]._nickname == nickname)
			{
				return this._bots[i];
			}
		}
	}
	else
	{
		nickname = nickname.toLowerCase();
		for (var i in this._bots)
		{
			if (this._bots[i]._nickname.toLowerCase() == nickname)
			{
				return this._bots[i];
			}
		}
	}
}

Service.prototype.findUser = function (nickname, ignoreCase)
{
	if (typeof ignoreCase == 'undefined' || !ignoreCase)
	{
		for (var i in this._users)
		{
			if (this._users[i]._nickname == nickname)
			{
				return this._users[i];
			}
		}
	}
	else
	{
		nickname = nickname.toLowerCase();
		for (var i in this._users)
		{
			if (this._users[i]._nickname.toLowerCase() == nickname)
			{
				return this._users[i];
			}
		}
	}
}

Service.prototype.findChannel = function (name, ignoreCase)
{
	if (typeof ignoreCase == 'undefined' || ignoreCase)
	{
		name = name.toLowerCase();
		for (var i in this._channels)
		{
			if (this._channels[i]._name.toLowerCase() == name)
			{
				return this._channels[i];
			}
		}
	}
	else
	{
		for (var i in this._channels)
		{
			if (this._channels[i]._name == name)
			{
				return this._channels[i];
			}
		}
	}
}

// internal
Service.prototype.introduceUser = function (nickname, ident, realname, hostname, server, hopcount, usermodes, vhost, cloaked)
{
	var u = new User(this);
	u._nickname = nickname;
	u._ident = ident;
	u._realname = realname;
	u._hostname = hostname;
	u._server = server;
	u._vhost = vhost;
	u._cloaked = cloaked;
	if (usermodes)
	{
		u._userModes = usermodes[0] == '+' ? usermodes.substr(1) : usermodes;
	}
	this._users.push(u);
	
	return u;
}

// internal
Service.prototype.deleteUser = function (user)
{
	for (var i in user._channels)
	{
		var c = user._channels[i];
		delete c._users[c._users.indexOf(user)];
		
		// Delete channel if 'user' was the only user
		if (c._users.length == 0)
		{
			delete this._channels[i];
		}
	}
	
	for (var i in this._users)
	{
		if (this._users[i] == user)
		{
			delete this._users[i];
			return true;
		}
	}
	return false;
}

// internal
Service.prototype.introduceChannel = function (channel)
{
	var c = new Channel(this);
	c._name = channel;
	this._channels.push(c);
	return c;
}

Service.prototype.__defineGetter__("bots", function ()
{
	var obj = { };
	for (var i in this._bots)
	{
		obj[this._bots[i]._nickname] = this._bots[i];
	}
	return obj;
});

Service.prototype.__defineGetter__("users", function ()
{
	var obj = { };
	for (var i in this._users)
	{
		obj[this._users[i]._nickname] = this._users[i];
	}
	return obj;
});

Service.prototype.__defineGetter__("channels", function ()
{
	var obj = { };
	for (var i in this._channels)
	{
		obj[this._channels[i]._name] = this._channels[i];
	}
	return obj;
});

Service.prototype.__defineGetter__("defaultBot", function ()
{
	return this._defaultBot;
});

Service.prototype.__defineSetter__("defaultBot", function (bot)
{
	if (!Bot.isBot(bot))
	{
		return;
	}
	
	this._defaultBot = bot;
});
