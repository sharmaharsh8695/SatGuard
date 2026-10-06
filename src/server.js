const app = require("./app");
const { PORT } = require("./config/constants");

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`SAT Guard is running on port ${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };