const express = require("express");
const spacecraftService = require("../services/spacecraftService");
const commandQueueService = require("../services/commandQueueService");
const { createCommandInstance } = require("../domain/commands/commandSchema");
const { validateCommand } = require("../domain/commands/commandValidation");
const { planExecution } = require("../domain/planning/executionPlanner");

const router = express.Router();

router.get("/commands/queue/plan", (request, response) => {
  const plan = planExecution({
    currentState: spacecraftService.getState(),
    commands: commandQueueService.getSnapshot(),
  });

  return response.json(plan);
});

router.post("/commands/queue/plan", (request, response) => {
  const validation = validateCommand(request.body);
  if (!validation.valid) {
    return response.status(400).json({ success: false, error: validation.error });
  }

  const proposedCommand = createCommandInstance({
    type: validation.command.type,
    parameters: validation.command.parameters,
  });
  const commands = [...commandQueueService.getSnapshot(), proposedCommand];
  const plan = planExecution({
    currentState: spacecraftService.getState(),
    commands,
  });

  return response.json(plan);
});

module.exports = router;