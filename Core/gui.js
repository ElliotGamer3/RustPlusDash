const path = require('path');

function getGuiPaths() {
	const publicDir = path.join(__dirname, 'public');

	return {
		publicDir,
		indexFile: path.join(publicDir, 'index.html'),
		appFile: path.join(publicDir, 'app.js')
	};
}

module.exports = {
	getGuiPaths
};
