const express = require("express");
const { evaluateCommand } = require("../domain/security/decisionEngine");
const incidentService = require("../services/incidentService");
const quarantineService = require("../services/quarantineService");

const router = express.Router();

router.post("/gateway/commands/evaluate", (request, response) => {
  return response.json(evaluateCommand(request.body));
});

router.get("/security/events", (request, response) => {
  return response.json({ events: incidentService.getEvents() });
});

router.get("/security/quarantine", (request, response) => {
  return response.json({ commands: quarantineService.getAll() });
});

module.exports = router;