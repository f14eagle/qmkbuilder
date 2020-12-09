const config = require('config')

const PORT = 5004;
const TMP = '/tmp/qmk-';
//const QMK_PATH = '/home/ubuntu/gitrepo/qmk_firmware_f14'
const QMK_PATH = config.get('QMK_PATH')

const Express = require('express');
const BodyParser = require('body-parser');
const Crypto = require('crypto');
const Exec = require('child_process').exec;
const Fs = require('fs');
const path = require('path')

const co = require('co');

const firmwareSettings = {
	'default': {
		'name': 'default',
		'hexName': ''
	},
	'redox': {
		'name': 'redox_f14',
		'hexName': 'redox_f14'
	},
	'corne': {
		'name': 'crkbd',
		'hexName': 'crkbd_rev1'
	},
	'wingxx_plus': {
		'name': 'wingxx_plus',
		'hexName': 'wingxx_plus'
	},
	'wingxx_plus_wireless': {
		'name': 'wingxxp_wireless',
		'hexName': 'wingxxp_wireless'
	},
	'wing68_plus': {
		'name': 'wing68_plus',
		'hexName': 'wing68_plus'
	},
	'wing68_plus_v2': {
		'name': 'wing68_plus',
		'hexName': 'wing68_plus'
	},
	'v60p': {
		'name': 'v60p',
		'hexName': 'v60p'
	},
	'v60': {
		'name': 'v60',
		'hexName': 'v60'
	},
	'vxx_wired': {
		'name': 'vxx_wired',
		'hexName': 'vxx_wired'
	},
	'vxxp': {
		'name': 'vxxp',
		'hexName': 'vxxp'
	},
	'f14_u1800lite_wired': {
		'name': 'f14_u1800lite_wired',
		'hexName': 'f14_u1800lite_wired'
	},
	'f14_u1800lite': {
		'name': 'f14_u1800lite',
		'hexName': 'f14_u1800lite'
	},
	'f14_ophelia': {
		'name': 'f14_ophelia',
		'hexName': 'f14_ophelia'
	},
	'f14_ophelia_wired': {
		'name': 'f14_ophelia_wired',
		'hexName': 'f14_ophelia_wired'
	},
}

// Create the express app.
const app = Express();
app.use(BodyParser.json());
app.use(BodyParser.urlencoded({ extended: true }));

// Allow cross-origin requests.
app.all('*', (req, res, next) => {
	res.header('Access-Control-Allow-Origin', '*');
	res.header('Access-Control-Allow-Headers', 'X-Requested-With');
	res.header('Access-Control-Allow-Headers', 'Content-Type');
	next();
});

app.use('/', Express.static(path.resolve(__dirname, '../static')))

// Set up the /build route.
app.post('/build', (req, res) => {
	// Get the files.
	const files = req.body;

	// Create a random key.
	const key = Crypto.randomBytes(16).toString('hex');
	console.log(`Tmp folder: ${ TMP + key }`)
	const templateName = files.templateName ? files.templateName : 'default'
	console.log(`Build firmware with templateName: ${ templateName }`)

	const firmwareSetting = firmwareSettings[templateName]
	const firmwareName = firmwareSetting ? firmwareSetting.name : 'default'
	const keymapFolder = 'bft'
	const targetKeymap = 'kb-' + key
	const firmwareBasePath = path.resolve(QMK_PATH, './keyboards', firmwareName)
	const keymapBasePath = path.resolve(firmwareBasePath, './keymaps')
	const keymapPath = path.resolve(keymapBasePath, keymapFolder)
	const targetPath = path.resolve(keymapBasePath, targetKeymap)
	const hexfile = `${ QMK_PATH }/${ firmwareSetting.hexName }_${ targetKeymap }.hex`

	// Setup helper functions.
	const clean = () => {
		console.log('Clean up temp files...')
		Exec('rm -rf ' + TMP + key);
		Exec('rm -rf ' + targetPath);
		Exec('rm -f ' + hexfile);
	};

	const sendError = err => {
		console.log(err)
		res.json({ error: err });
		clean();
	};

	// Start.
	co(function*() {
		if(templateName == 'default'){
			// If templateName is default, use original logic to generate firmware

			// Copy the base stencil.
			yield new Promise((resolve, reject) => {
				Exec('cp -rp qmk_firmware ' + TMP + key, (err, stdout, stderr) => {
					if (err) return reject('Failed to initialize.');
					resolve();
				});
			});

			// Copy all the files.
			for (const file in files) {
				yield new Promise((resolve, reject) => {
					const fileName = file.replace('qmk_firmware', TMP + key);
					Fs.writeFile(fileName, files[file], err => {
						if (err) return reject('Failed to initialize.');
						resolve();
					});
				});
			}

			// Make.
			yield new Promise((resolve, reject) => {
				Exec('cd ' + TMP + key + '/keyboards/kb && make', (err, stdout, stderr) => {
					if (err) return reject(stderr);
					resolve();
				});
			});

			// Read the hex file.
			const hex = yield new Promise((resolve, reject) => {
				Fs.readFile(TMP + key + '/kb_default.hex', 'utf8', (err, data) => {
					if (err) return reject('Failed to read hex file.');
					resolve(data);
				});
			});

			// Send the hex file.
			res.json({ hex: hex });

			// Clean up.
			clean();
		}else{
			// If user specified templateName, use qmk_firmware env to build
			

			// Copy the base stencil.
			yield new Promise((resolve, reject) => {
				Exec(`cp -rp ${ keymapPath } ${ targetPath }`, (err, stdout, stderr) => {
					if (err){
						console.log(err)
						return reject('Failed to create target keymap directory')
					} 
					resolve();
				});
			});

			// Copy keymap file onlye
			for (const file in files) {
				yield new Promise((resolve, reject) => {
					// Only process keymap file
					const filecontent = files[file]
					if(file.includes('keymap')){
						var filename = targetPath + '/keymap.c'
						// const filecontent = files[file].replace('kb.h', `${ firmwareName }.h`)
						const keymapContent = filecontent.substring(filecontent.indexOf('//--keymap-start'), filecontent.indexOf('//--keymap-end'))
						.replace(/KEYMAP\(/g, 'LAYOUT(')
						const macroContent = filecontent.substring(filecontent.indexOf('//--macro-start'), filecontent.indexOf('//--macro-end'))

						Fs.readFile(filename, { encoding: 'utf-8'}, (err, data) => {
							if(err){
								console.log(err)
								return reject(`Read ${ filename } failed`)
							}

							var content = data.replace('%keymap%', keymapContent).replace('%macro%', macroContent)
							Fs.writeFile(filename, content, err => {
								if (err){
									console.log(err)
									return reject('Failed to write file from request')
								} 
								resolve();
							})
						})
					}else if(file.includes('rules')){
						var filename = targetPath + '/rules.mk'
						if(!Fs.existsSync(filename)){
							return resolve()
						}
						const viaContent = filecontent.substring(filecontent.indexOf('//--via-start'), filecontent.indexOf('//--via-end')).replace('//','#')

						Fs.readFile(filename, { encoding: 'utf-8'}, (err, data) => {
							if(err){
								console.log(err)
								return reject(`Read ${ filename } failed`)
							}

							var content = data.replace('%via%', viaContent)
							Fs.writeFile(filename, content, err => {
								if (err){
									console.log(err)
									return reject('Failed to write file from request')
								} 
								resolve();
							})
						})
					}else{
						return resolve()
					}

				});
			}

			// Make.
			yield new Promise((resolve, reject) => {
				Exec(`cd ${ QMK_PATH } && make ${ firmwareName }:${ targetKeymap }`, (err, stdout, stderr) => {
					if (err){
						console.log(err)
						return reject(stderr);
					}
					resolve();
				});
			});

			// Read the hex file.
			const hex = yield new Promise((resolve, reject) => {
				console.log(`Read hex file: ${ hexfile }`)
				Fs.readFile(hexfile, 'utf8', (err, data) => {
					if (err){
						console.log(err)
						return reject('Failed to read hex file.');
					}
					resolve(data);
				});
			});

			// Send the hex file.
			res.json({ hex: hex });

			clean()
		}
		
	}).catch(e => sendError(e));
});

// Start listening.
app.listen(PORT, () => console.log('Listening on port ' + PORT + '...'));