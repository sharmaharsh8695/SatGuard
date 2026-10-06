const express = require("express");
const commandQueueService = require("../services/commandQueueService");
const { evaluateCommandEnvelope } = require("../domain/security/securityGateway");

const router = express.Router();

router.post("/gateway/commands", (request, response) => {
  const gatewayResult = evaluateCommandEnvelope(request.body);
  const { acceptedCommand, ...publicResult } = gatewayResult;

  if (gatewayResult.decision !== "ACCEPTED") {
    return response
      .status(rejectionStatus(gatewayResult.failedStage))
      .json(publicResult);
  }

  const enqueueResult = commandQueueService.enqueue(acceptedCommand, {
    preserveId: true,
  });
  if (!enqueueResult.success) {
    return response.status(409).json({
      ...publicResult,
      decision: "REJECTED",
      failedStage: "queue",
      checks: {
        ...publicResult.checks,
        queue: { passed: false, reason: enqueueResult.error.message },
      },
      message: enqueueResult.error.message,
    });
  }

  return response.status(202).json({
    ...publicResult,
    checks: {
      ...publicResult.checks,
      queue: {
        passed: true,
        enqueued: true,
        status: enqueueResult.command.status,
        sequence: enqueueResult.command.sequence,
      },
      integrity: {
        ...publicResult.checks.integrity,
        passed: true,
      },
    },
    message: "Command accepted by security gateway and added to the queue",
  });
});

function rejectionStatus(stage) {
  if (stage === "authentication" || stage === "integrity") return 401;
  if (stage === "authorization") return 403;
  if (stage === "replay") return 409;
  return 400;
}

module.exports = router;