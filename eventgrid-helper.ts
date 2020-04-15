import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";

export function retrieveEventGridKey(functionApp: azure.appservice.FunctionApp, attempts: number): pulumi.Output<string> {
    return functionApp.getHostKeys().apply(async ks => {
        const k = ks.systemKeys["eventgrid_extension"];
        if (k) return pulumi.output(k);

        if (attempts === 0) {
            throw new Error("timed out waiting for Webhook to become up");
        }

        // Wait for 10s between polls
        pulumi.log.info(`Waiting for 'eventgrid_extension' key to become available (${attempts})`, functionApp);
        await new Promise(r => setTimeout(r, 10000));

        return retrieveEventGridKey(functionApp, attempts - 1);
    }).apply(v => v);
}

export async function waitUntilEndpointIsUp(url: string): Promise<string> {
    if (pulumi.runtime.isDryRun()) {
        return url;
    }

    // Prepare a sample webhook validation call.
    const headers = { "aeg-event-type": "SubscriptionValidation" };
    const body = "[{ \"data\": { \"validationCode\": \"pulumi-create\" }, \"eventType\": \"Microsoft.EventGrid.SubscriptionValidationEvent\" }]";

    // Wait for up to 5 minutes
    for (let i = 0; i < 30; i++) {
        let status;
        try {
            const response = await fetch(url, { method: "POST", headers, body });
            if (response.ok) {
                return url;
            }
            status = `${response.status}: ${response.statusText}`;
        } catch (e) {
            status = `Error: ${e}`;
        }
        // Wait for 10s between polls
        await new Promise(r => setTimeout(r, 10000));
    }

    throw new Error("timed out waiting for Webhook to become up");
}