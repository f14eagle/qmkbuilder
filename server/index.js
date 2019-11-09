const PORT = 5004;
const TMP = '/tmp/qmk-';

const Express = require('express');
const BodyParser = require('body-parser');
const Crypto = require('crypto');
const Exec = require('child_process').exec;
const Fs = require('fs');
const path = require('path')

const co = require('co');
const templateBasedir = path.resolve(__dirname, './keyboardTemplate')

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
	const templateName = files.templateName ? files.templateName : 'default'
	const templateDir = path.resolve(templateBasedir, templateName)

	console.log(`Build firmware with templateName: ${ templateName }`)

	// Setup helper functions.
	const clean = () => {
		Exec('rm -rf ' + TMP + key);
	};

	const sendError = err => {
		console.log(err)
		res.json({ error: err });
		// clean();
	};

	// Start.
	co(function*() {
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

		// Copy template files if exists
		yield new Promise((resolve, reject) => {
			Fs.stat(templateDir, err => {
				if(err){
					console.log(`Template folder not exists: ${ templateDir }`)
					resolve()
				}else{
					console.log(`Copy template files: ${ templateDir }`)
					const targetDir = path.resolve(TMP + key, './keyboards/kb')
					Exec('cp -rp ' + templateDir + '/* ' + targetDir + '/', (err, stdout, stderr) => {
						if(err) return reject('Copy template files error')
						resolve()
					})
				}
			})
		})

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
	}).catch(e => sendError(e));
});

// Start listening.
app.listen(PORT, () => console.log('Listening on port ' + PORT + '...'));
