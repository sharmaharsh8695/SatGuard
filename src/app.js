const express = require("express");
const healthRoutes = require("./routes/health.routes");
const spacecraftRoutes = require("./routes/spacecraft.routes");
const consequenceRoutes = require("./routes/consequence.routes");
const executionPlanRoutes = require("./routes/executionPlan.routes");
const commandQueueRoutes = require("./routes/commandQueue.routes");
const securityGatewayRoutes = require("./routes/securityGateway.routes");
const securityDecisionRoutes = require("./routes/securityDecision.routes");
const scenarioRoutes = require("./routes/scenario.routes");
const groundStationRoutes = require("./routes/groundStation.routes");
const attackLabRoutes = require("./routes/attackLab.routes");

const app = express();

app.use(express.json());
app.use(healthRoutes);
app.use(spacecraftRoutes);
app.use(consequenceRoutes);
app.use(executionPlanRoutes);
app.use(commandQueueRoutes);
app.use(securityGatewayRoutes);
app.use(securityDecisionRoutes);
app.use(scenarioRoutes);
app.use(groundStationRoutes);
app.use(attackLabRoutes);

app.use((error, request, response, next) => {
	if (response.headersSent) {
		return next(error);
	}

	if (error.type === "entity.parse.failed") {
		return response.status(400).json({
			success: false,
			error: { code: "INVALID_JSON", message: "Request body must be valid JSON" },
		});
	}

	return response.status(500).json({
		success: false,
		error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
	});
});

module.exports = app;