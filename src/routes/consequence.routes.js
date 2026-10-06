const express = require("express");
const spacecraftService = require("../services/spacecraftService");
const commandQueueService = require("../services/commandQueueService");
const consequenceSimulator = require("../services/consequenceSimulator");
const { validateCommand } = require("../domain/commands/commandValidation");

const router = express.Router();

router.get("/commands/queue/simulation", (request, response) => {
  const result = consequenceSimulator.simulate({
    currentState: spacecraftService.getState(),
    commands: commandQueueService.getSnapshot(),
  });

  response.json(result);
});

router.post("/commands/queue/simulation", (request, response) => {
  const validation = validateCommand(request.body);
  if (!validation.valid) {
    return response.status(400).json({ success: false, error: validation.error });
  }

  const result = consequenceSimulator.simulate({
    currentState: spacecraftService.getState(),
    commands: [...commandQueueService.getSnapshot(), validation.command],
  });

  return response.json(result);
});

module.exports = router;