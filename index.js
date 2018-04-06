'use strict';

// Nut (Network UPS Tool) Platform for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//         "platform": "Nut",					// required
//         "name": "Nut",						// required - Used for platform logging tags.
//         "host": "localhost",					// Optional - defaults to localhost
//         "port": "3493",						// Optional - defaults to 3493
//         "search_time_delay": "1",			// Optional - defaults to 1 second. Initial search time delay in seconds.
//         "low_batt_threshold": "40",			// Optional - defaults to 40%. Low Battery Threshold.
//         "polling": "120"						// Optional - defaults to OFF or 0. Time in seconds.
//     }
// ],
//
//

var Nut = require("node-nut");
var _ = require("underscore");
var titleCase = require('title-case');
var pNut, connected;

function NutPlatform(log, config){
	this.config = config;
	this.host = config["host"] || 'localhost';
	this.port = config["port"] || '3493';
	this.name = config["name"];
	this.nutListTimeout = config["search_time_delay"] || '1';
	this.nutListTimeout *= 1000;
	this.nutPolling = config["polling"] || '0';
	this.lowBattThreshold = config["low_batt_threshold"] || '40';
	this.log = log;
	this.log("Starting Nut Platform on %s:%s. Polling (seconds): %s", this.host, this.port, (this.nutPolling == '0') ? 'OFF' : this.nutPolling);
	this.initialized = false;
	var nutAccessories, upsInfo;
	connected = false;

	pNut = new Nut(this.port, this.host);

	pNut.on('ready', this.eventReady.bind(this));
	pNut.on('close', this.eventClose.bind(this));
	pNut.on('error', this.eventError.bind(this));

	pNut.start();
}

NutPlatform.prototype = {
    accessories: function(callback) {
        var that = this;
        var foundAccessories = [];
		var acc, accName, accFriendlyName;
		setTimeout(function() {
			accName = _.keys(that.nutAccessories);
			accFriendlyName = _.values(that.nutAccessories);
			for (acc in accName) {
				var titleName;
				that.log("Received Nut accessory %s (%s) from the %s platform.", accName[acc], ((!accFriendlyName[acc]) ? 'NullDesc' : accFriendlyName[acc]), that.name);
				that.getInfo(accName[acc], function(err, upsInfo) {
					if (!err) {
						titleName = titleCase((accFriendlyName[acc] || accName[acc])); //Added in case ups.conf description is empty.
						var accessory = new NutAccessory(that, accName[acc], titleName, upsInfo);
						that.initialized = true;
						foundAccessories.push(accessory);
						callback(foundAccessories);
					} else {
						that.log.error("Nut Error: %s", err);
						callback(foundAccessories);
					}
				});
			}
		}, this.nutListTimeout);
	},

	eventReady: function() {
		var that = this;
		if (!that.initialized) {
			connected = true;
			this.log.debug("Nut eventReady received. Initializing and getting list of Nut accessories.");
			pNut.GetUPSList(function(upslist, err) {
				if (err) {
					that.log.error;('Nut ERROR initializing: ' + err);
				}
				else {
					that.nutAccessories = upslist;
				}
			});
		} else {
			connected = true;
			this.log.debug("Nut eventReady received. Successful reconnect after disconnection.");
		}
	},

	eventClose: function() {
		var that = this;
		connected = false;
		this.log.debug("Nut eventDisconnect occured.");
	},

	eventError: function(error) {
		this.log.error("Nut eventError received - %s.", error);
	},

	getInfo: function(upsName, callback) {
		var that = this;
		if (connected) {
			pNut.GetUPSVars(upsName, function(upsvars, err) {
				if (err) {
					callback("ERROR getting UPSVars: " + err, null);
				} else {
					callback(null, upsvars);
				}
			});
		} else {
			callback("ERROR not connected to Nut", null);
		}
	}
}

function NutAccessory(platform, accessory, accessoryFriendly, accessoryVars) {
	this.nutName = accessory;
	this.name = accessoryFriendly;
	this.accVars = accessoryVars;
	this.platform = platform;
    this.log = this.platform.log;
	this.nutPolling = this.platform.nutPolling;
	this.nutPolling *= 1000;
	this.lowBattThreshold = this.platform.lowBattThreshold;
	if (this.nutPolling > 0) {
		var that = this;
		setTimeout(function() {
			that.log.debug('Nut Service Polling begin for %s...', that.name);
			that.servicePolling();
		}, this.nutPolling);
	};
}

NutAccessory.prototype = {

	identify: function(callback){
		this.log.debug("Nut Identify requested for %s!", this.name);
		callback();
	},

	getCheck: function(callback){
        var that = this;
		this.log.debug('Nut checking connection to Nut Server for %s.', this.name);
		if (connected) {
			this.log.debug('Nut connection to Nut Server Successful.');
			that.getVars(function(callback) {
			}.bind(this));
		} else {
			this.log.debug('Nut NOT connected, attempting 1st reconnection attempt...');
			pNut.start();
			setTimeout(function() {
				if (connected) {
					that.getVars(function (callback) {
					}.bind(this));
				} else {
					that.log.error('Nut unable to reconnect!');
					that.service.setCharacteristic(Characteristic.StatusFault,1);
				}
			}, this.platform.nutListTimeout+1000); //  <<<--- May need to be adjusted- Timing issue for some?
		}
	callback();
	},

    getVars: function(callback){
        var that = this;
		this.log.debug('Nut request to get vars for %s.', this.name);
		if (connected) {
			this.platform.getInfo(this.nutName, function(err, upsInfo) {
				if (!err) {
					that.service.setCharacteristic(Characteristic.StatusFault,0);
					that.serviceBatt.setCharacteristic(Characteristic.BatteryLevel,parseFloat(upsInfo["battery.charge"]));

					that.service.setCharacteristic(EnterpriseTypes.InputVoltageAC, parseFloat(upsInfo["input.voltage"]));
					that.service.setCharacteristic(EnterpriseTypes.OutputVoltageAC, parseFloat(upsInfo["output.voltage"]));
					that.service.setCharacteristic(EnterpriseTypes.BatteryVoltageDC, parseFloat(upsInfo["battery.voltage"]));
					that.service.setCharacteristic(EnterpriseTypes.UPSLoadPercent, parseInt(upsInfo["ups.load"]));
					that.service.setCharacteristic(Characteristic.CurrentTemperature, parseFloat(upsInfo["ups.temperature"]));

					if (parseInt(upsInfo["battery.charge"]) < parseInt(that.lowBattThreshold)) {
						that.serviceBatt.setCharacteristic(Characteristic.StatusLowBattery,1);
					} else {
						that.serviceBatt.setCharacteristic(Characteristic.StatusLowBattery,0);
					}
					if (upsInfo["ups.status"] == "OL CHRG") {
						that.serviceBatt.setCharacteristic(Characteristic.ChargingState,1);
					} else if (upsInfo["ups.status"] == "OB DISCHRG") {
						that.serviceBatt.setCharacteristic(Characteristic.ChargingState,2);
					} else {
						that.serviceBatt.setCharacteristic(Characteristic.ChargingState,0);
					}
					if (parseInt(upsInfo["ups.load"]) > 0) {
						that.service.setCharacteristic(Characteristic.StatusActive,1);
					} else {
						that.service.setCharacteristic(Characteristic.StatusActive,0);
					}
					if (upsInfo["ups.status"].startsWith("OB")) {
						that.service.setCharacteristic(Characteristic.ContactSensorState,1);
					} else {
						that.service.setCharacteristic(Characteristic.ContactSensorState,0);
					}
				} else {
					that.log.error("Nut Error: %s", err);
					that.service.setCharacteristic(Characteristic.StatusFault,1);
				}
			}.bind(this));
		} else {
			this.log.error('Nut request failed. Not connected.');
			that.service.setCharacteristic(Characteristic.StatusFault,1);
		}
		callback();
	},

	servicePolling: function(){
		var that = this;
		this.log.debug('Nut is Polling for %s...', this.name);
		this.getCheck(function (callback) {
			setTimeout(function() {
				that.servicePolling();
			}, that.nutPolling);
		});
	},

    getServices: function() {
        var that = this;
        var services = []

		this.service = new Service.ContactSensor(this.name);
		this.service.getCharacteristic(Characteristic.ContactSensorState) // Based on ups.status
			.on('get', this.getCheck.bind(this));;
		this.service.addCharacteristic(Characteristic.StatusActive); // Has load (being used)
		this.service.addCharacteristic(Characteristic.StatusFault); // Used if unable to connect to Nut Server
	  	this.service.addCharacteristic(Characteristic.CurrentTemperature);
	    this.service.addCharacteristic(EnterpriseTypes.InputVoltageAC);
	    this.service.addCharacteristic(EnterpriseTypes.OutputVoltageAC);
	    this.service.addCharacteristic(EnterpriseTypes.BatteryVoltageDC);
		this.service.addCharacteristic(EnterpriseTypes.UPSLoadPercent);
		services.push(this.service);

		var serviceInfo = new Service.AccessoryInformation();
  		serviceInfo.setCharacteristic(Characteristic.Manufacturer, this.accVars["device.mfr"] || this.accVars["ups.vendorid"] || 'No Manufacturer')
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.SerialNumber, this.accVars["ups.serial"] || 'No Serial#')
			.setCharacteristic(Characteristic.FirmwareRevision, this.accVars["ups.firmware"] || 'No Data')
			.setCharacteristic(Characteristic.Model, this.accVars["device.model"].trim() || this.accVars["ups.productid"] || 'No Model#');
    services.push(serviceInfo);

		this.serviceBatt = new Service.BatteryService();
		this.serviceBatt.setCharacteristic(Characteristic.BatteryLevel, this.accVars["battery.charge"])
			.setCharacteristic(Characteristic.Name, this.name)
			.setCharacteristic(Characteristic.ChargingState, 0)
			.setCharacteristic(Characteristic.StatusLowBattery, 0);
		services.push(this.serviceBatt);

		return services;
    }
}

module.exports.accessory = NutAccessory;
module.exports.platform = NutPlatform;

var Service, Characteristic, EnterpriseTypes;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  EnterpriseTypes = require('./types.js')(homebridge);

  homebridge.registerAccessory("homebridge-nut-accessory", "NutAccessory", NutAccessory);
  homebridge.registerPlatform("homebridge-nut", "Nut", NutPlatform);
};
