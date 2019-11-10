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

const firmwareMapping = {
	'default': 'default',
	'redox': 'redox_f14'
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

	const firmwareName = firmwareMapping[templateName]
	const keymapFolder = 'bft'
	const targetKeymap = 'kb-' + key
	const firmwareBasePath = path.resolve(QMK_PATH, './keyboards', firmwareName)
	const keymapBasePath = path.resolve(firmwareBasePath, './keymaps')
	const keymapPath = path.resolve(keymapBasePath, keymapFolder)
	const targetPath = path.resolve(keymapBasePath, targetKeymap)
	const hexfile = `${ QMK_PATH }/${ firmwareName }_${ targetKeymap }.hex`

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
					if(!file.includes('keymap')){
						return resolve()
					}
					const filename = targetPath + '/keymap.c'
					const filecontent = files[file].replace('kb.h', `${ firmwareName }.h`)
					Fs.writeFile(filename, filecontent, err => {
						if (err){
							console.log(err)
							return reject('Failed to write file from request')
						} 
						resolve();
					});
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
