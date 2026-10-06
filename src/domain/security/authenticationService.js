const { timingSafeEqual } = require("node:crypto");
const { PROTOTYPE_OPERATORS } = require("../../config/constants");

function authenticateOperator(operatorId, credential) {
  const operator = getOperator(operatorId);
  if (!operator) {
    return {
      authenticated: false,
      operatorId: typeof operatorId === "string" ? operatorId : null,
      role: null,
      reason: "Unknown operator",
    };
  }

  const provided = Buffer.from(typeof credential === "string" ? credential : "");
  const expected = Buffer.from(operator.authToken);
  const comparable = provided.length === expected.length
    ? provided
    : Buffer.alloc(expected.length);
  const matches = timingSafeEqual(expected, comparable) && provided.length === expected.length;

  return {
    authenticated: matches,
    operatorId: operator.id,
    role: matches ? operator.role : null,
    reason: matches ? "Operator credential is valid" : "Invalid operator credential",
  };
}

function getOperator(operatorId) {
  return Object.hasOwn(PROTOTYPE_OPERATORS, operatorId)
    ? PROTOTYPE_OPERATORS[operatorId]
    : null;
}

module.exports = { authenticateOperator, getOperator };