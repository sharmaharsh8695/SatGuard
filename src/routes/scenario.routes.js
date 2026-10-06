const express = require("express");
const scenarioService = require("../domain/scenarios/scenarioService");

const router = express.Router();

router.get("/scenarios", (request, response) => {
  return response.json(scenarioService.listScenarios());
});

router.post("/scenarios/reset", (request, response) => {
  return response.json(scenarioService.resetDemoState());
});

router.post("/scenarios/:scenarioId/run", (request, response) => {
  const result = scenarioService.runScenario(request.params.scenarioId);
  if (!result) {
    return response.status(404).json({
      error: { code: "SCENARIO_NOT_FOUND", message: "Unknown demo scenario" },
    });
  }

  return response.json(result);
});

module.exports = router;