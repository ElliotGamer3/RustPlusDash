const path = require('path');

function getGuiPaths() {
	const publicDir = path.join(__dirname, 'public');

	return {
		publicDir,
		indexFile: path.join(publicDir, 'index.html'),
		appFile: path.join(publicDir, 'app.js'),
		registerHtml: path.join(publicDir, 'register.html'),
		registerFile: path.join(publicDir, 'register.js'),
	};
}

module.exports = {
	getGuiPaths
};
