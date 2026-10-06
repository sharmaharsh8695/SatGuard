const express = require("express");
const spacecraftService = require("../services/spacecraftService");

const router = express.Router();

// Development simulator API; later milestones will put the security gateway in front of execution.
router.get("/spacecraft/state", (request, response) => {
  response.json({ state: spacecraftService.getState() });
});

router.post("/spacecraft/commands", (request, response) => {
  const outcome = spacecraftService.executeCommand(request.body);
  const statusCode = outcome.success
    ? 200
    : outcome.error.code === "INVALID_STATE"
      ? 409
      : 400;

  response.status(statusCode).json(outcome);
});

module.exports = router;