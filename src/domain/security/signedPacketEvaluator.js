const { evaluateCommand } = require("./decisionEngine");
const { getOperator } = require("./authenticationService");

function evaluateSignedPacket(packet) {
  const operator = getOperator(packet?.operatorId);
  return evaluateCommand({
    operatorId: packet?.operatorId,
    credential: operator?.authToken ?? "",
    command: structuredClone(packet?.command),
    signature: packet?.signature,
  });
}

module.exports = { evaluateSignedPacket };