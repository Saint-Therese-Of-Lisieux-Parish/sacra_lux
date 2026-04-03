const { startServer } = require("./server");

const PORT = Number(process.env.PORT || 17841);

startServer(PORT);
