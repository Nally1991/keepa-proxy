import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const KEEPA_API_KEY = process.env.KEEPA_API_KEY;
const PROXY_API_KEY = process.env.PROXY_API_KEY;

app.use(express.json());

function getProvidedApiKey(req) {
  return req.headers["x-api-key"] || req.headers["X-Api-Key"] || null;
}

function isAuthorized(req) {
  const providedApiKey = getProvidedApiKey(req);
  return Boolean(PROXY_API_KEY && providedApiKey && providedApiKey === PROXY_API_KEY);
}

function isAsin(value) {
  return /^[A-Z0-9]{10}$/i.test(value);
}

function isProductCode(value) {
  return /^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$/.test(value);
}

async function callKeepaByAsin(domain, asin) {
  const url = new URL("https://api.keepa.com/product");

  url.searchParams.set("key", KEEPA_API_KEY);
  url.searchParams.set("domain", String(domain));
  url.searchParams.set("asin", asin);
  url.searchParams.set("stats", "90");
  url.searchParams.set("history", "0");
  url.searchParams.set("rating", "1");
  url.searchParams.set("buybox", "1");

  const response = await fetch(url.toString());
  const data = await response.json();

  return {
    httpStatus: response.status,
    data
  };
}

async function resolveAsinFromCode(domain, code) {
  const manualMap = {
    "8809747923571": {
      asin: "B09KNBVCNT",
      title: "MISSHA Vita C Plus Spot Correcting & Firming Ampoule 30ml"
    }
  };

  const found = manualMap[code];

  if (!found || !found.asin) {
    return {
      found: false,
      asin: null,
      code,
      domain,
      title: found?.title || null,
      message: "No se pudo resolver este EAN a ASIN. El código no está en manualMap."
    };
  }

  return {
    found: true,
    asin: found.asin,
    code,
    domain,
    title: found.title || null,
    message: "ASIN resuelto correctamente"
  };
}

function simplifyKeepaProduct(keepaResult) {
  const keepaData = keepaResult.data;
  const product = keepaData.products?.[0];

  if (!product) {
    return {
      found: false,
      source: "keepa",
      keepaHttpStatus: keepaResult.httpStatus,
      message: keepaData.error?.message || "Keepa no devolvió productos.",
      tokensLeft: keepaData.tokensLeft ?? null,
      raw: keepaData
    };
  }

  return {
    found: true,
    source: "keepa",
    keepaHttpStatus: keepaResult.httpStatus,
    asin: product.asin || null,
    domain: product.domainId || null,
    title: product.title || null,
    brand: product.brand || null,
    manufacturer: product.manufacturer || null,
    imagesCSV: product.imagesCSV || null,
    eanList: product.eanList || [],
    upcList: product.upcList || [],
    rootCategory: product.rootCategory || null,
    tokensLeft: keepaData.tokensLeft ?? null,
    raw: product
  };
}

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    name: "Keepa Proxy API",
    routes: ["/lookup", "/diagnostic"]
  });
});

app.get("/diagnostic", (req, res) => {
  res.status(200).json({
    status: "ok",
    proxyApiKeyConfigured: Boolean(PROXY_API_KEY),
    keepaApiKeyConfigured: Boolean(KEEPA_API_KEY),
    message: "El servidor está funcionando. Este endpoint no muestra claves privadas."
  });
});

app.get("/lookup", async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(200).json({
        found: false,
        authOk: false,
        message: "PROXY_API_KEY incorrecta o no enviada. Revisa la autenticación del GPT Action.",
        expectedHeaderName: "x-api-key"
      });
    }

    if (!KEEPA_API_KEY) {
      return res.status(200).json({
        found: false,
        authOk: true,
        message: "Falta KEEPA_API_KEY en Render."
      });
    }

    const domain = Number(req.query.domain || 9);
    const identifier = String(req.query.identifier || "").trim();

    if (!identifier) {
      return res.status(200).json({
        found: false,
        authOk: true,
        message: "Falta identifier. Envía un ASIN o un EAN."
      });
    }

    let asin = null;
    let resolvedFrom = null;

    if (isAsin(identifier)) {
      asin = identifier;
    } else if (isProductCode(identifier)) {
      resolvedFrom = await resolveAsinFromCode(domain, identifier);

      if (!resolvedFrom.found || !resolvedFrom.asin) {
        return res.status(200).json({
          found: false,
          authOk: true,
          code: identifier,
          domain,
          message: "No se pudo resolver el código a ASIN.",
          resolvedFrom
        });
      }

      asin = resolvedFrom.asin;
    } else {
      return res.status(200).json({
        found: false,
        authOk: true,
        message: "Identificador inválido. Usa ASIN o EAN/GTIN/UPC/ISBN.",
        identifier
      });
    }

    const keepaResult = await callKeepaByAsin(domain, asin);
    const simplified = simplifyKeepaProduct(keepaResult);

    return res.status(200).json({
      ...simplified,
      authOk: true,
      requestedIdentifier: identifier,
      resolvedFrom
    });
  } catch (error) {
    return res.status(200).json({
      found: false,
      authOk: true,
      message: "Error interno en /lookup.",
      detail: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Keepa proxy running on port ${PORT}`);
});
