import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure";
import * as eventgridHelper from './eventgrid-helper';


const resourceGroup = new azure.core.ResourceGroup("rg-msgstor-plm-002");

const azfunaccount = new azure.storage.Account("azfun1storage", {
    resourceGroupName: resourceGroup.name,
    accountTier: "Standard",
    accountReplicationType: "LRS",
});

const azfuncontainer = new azure.storage.Container("azfun1container", {
    storageAccountName: azfunaccount.name,
    containerAccessType: "private",
});

const azfunblob = new azure.storage.Blob("azfun1zip", {
    storageAccountName: azfunaccount.name,
    storageContainerName: azfuncontainer.name,
    type: "Block",
    source: new pulumi.asset.FileArchive("./HelloEventGrid/HelloEventGrid/bin/Debug/netcoreapp3.1/publish")
});

const azfunblobUrl = azure.storage.signedBlobReadUrl(azfunblob, azfunaccount);

const appServicePlan = new azure.appservice.Plan("azfun1asp", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    kind: "FunctionApp",
    sku: {
        tier: "Basic",
        size: "D1",
    }
});

const azfunAppInsights = new azure.appinsights.Insights("azfun1ai", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    applicationType: "web",
});


const config = new pulumi.Config();
const username = config.require("sqlUsername");
const pwd = config.require("sqlPassword");

const sqlserver = new azure.sql.SqlServer("msgstorsrv", {
    resourceGroupName: resourceGroup.name,
    location: resourceGroup.location,
    administratorLogin: username,
    administratorLoginPassword: pwd,
    version: "12.0",
});

const sqldatabase = new azure.mssql.Database("msgstordb", {
    serverId: sqlserver.id,
    collation: "SQL_Latin1_General_CP1_CI_AS",
    licenseType: "BasePrice",
    skuName: "HS_Gen5_4",
});

const azfunApp = new azure.appservice.FunctionApp("azfun1app", {
    resourceGroupName: resourceGroup.name,
    appServicePlanId: appServicePlan.id,
    storageConnectionString: azfunaccount.primaryConnectionString,
    
    version: "~3",
    appSettings: {
        "runtime": "dotnet",
        "FUNCTION_APP_EDIT_MODE": "readonly",
        "WEBSITE_RUN_FROM_PACKAGE": azfunblobUrl,
        "APPINSIGHTS_INSTRUMENTATIONKEY": azfunAppInsights.instrumentationKey,
    },

    connectionStrings: [{
        name: "MetadataSqlConnection",
        value:
            pulumi.all([sqlserver.name, sqldatabase.name]).apply(([server, db]) =>
                `Server=tcp:${server}.database.windows.net;initial catalog=${db};user ID=${username};password=${pwd};Min Pool Size=0;Max Pool Size=30;Persist Security Info=true;`),
        type: "SQLAzure",
    }],
});

const metadataaccount = new azure.storage.Account("metadatastorage", {
    resourceGroupName: resourceGroup.name,
    accountTier: "Standard",
    accountReplicationType: "LRS",
});

const metadatacontainer = new azure.storage.Container("metadatacontainer", {
    storageAccountName: metadataaccount.name,
    containerAccessType: "blob",
});

export const eventgridkey = eventgridHelper.retrieveEventGridKey(azfunApp, 30 /* 5 minutes */);
export const eventgridurl = pulumi.interpolate`https://${azfunApp.defaultHostname}/runtime/webhooks/eventgrid?functionName=Function1&code=${eventgridkey}`;
export const liveUrl = eventgridurl.apply(u => eventgridHelper.waitUntilEndpointIsUp(u));

const subscription = new azure.eventgrid.EventSubscription('azfuneventsub', {
    webhookEndpoint: { url: liveUrl },
    eventDeliverySchema: "EventGridSchema",
    includedEventTypes: [ "Microsoft.Storage.BlobCreated" ],
    scope: metadataaccount.id,
}, { parent: metadataaccount });