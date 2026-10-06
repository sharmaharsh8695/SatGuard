const express = require("express");
const commandQueueService = require("../services/commandQueueService");

const router = express.Router();

router.get("/commands/queue", (request, response) => {
  response.json({ commands: commandQueueService.getAll() });
});

router.get("/commands/held", (request, response) => {
  response.json({ commands: commandQueueService.getHeld() });
});

router.post("/commands/queue", (request, response) => {
  const outcome = commandQueueService.enqueue(request.body);
  if (!outcome.success) {
    return response.status(400).json(outcome);
  }

  return response.status(202).json(outcome);
});

router.get("/commands/queue/:id", (request, response) => {
  const command = commandQueueService.getById(request.params.id);
  if (!command) {
    return response.status(404).json({
      success: false,
      error: { code: "COMMAND_NOT_FOUND", message: "Command not found" },
    });
  }

  return response.json({ command });
});

router.delete("/commands/queue/:id", (request, response) => {
  const outcome = commandQueueService.cancel(request.params.id);
  return response.status(outcome.success ? 200 : queueErrorStatus(outcome)).json(outcome);
});

router.post("/commands/queue/:id/execute", (request, response) => {
  const outcome = commandQueueService.execute(request.params.id);
  return response.status(outcome.success ? 200 : queueErrorStatus(outcome)).json(outcome);
});

function queueErrorStatus(outcome) {
  if (outcome.error.code === "COMMAND_NOT_FOUND") {
    return 404;
  }

  if (outcome.error.code === "INVALID_STATE" || outcome.error.code.startsWith("COMMAND_ALREADY_")) {
    return 409;
  }

  return 400;
}

module.exports = router;