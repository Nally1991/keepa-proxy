import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;
const KEEPA_API_KEY = process.env.KEEPA_API_KEY;
const PROXY_API_KEY = process.env.PROXY_API_KEY;

app.use(express.json());

function checkAuth(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!apiKey || apiKey !== PROXY_API_KEY) {
    return res.status(401).json({
      found: false,
      message: "API key inválida o ausente"
    });
  }

  next();
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

  return data;
}

async function resolveAsinFromCode(domain, code) {
  const manualMap = {
    "8809747923571": {
      asin: B09KNBVCNT,
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
      message: "No se pudo resolver este EAN a ASIN"
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

function simplifyKeepaProduct(keepaData) {
  const product = keepaData.products?.[0];

  if (!product) {
    return {
      found: false,
      message: keepaData.error?.message || "Keepa no devolvió productos",
      tokensLeft: keepaData.tokensLeft ?? null,
      raw: keepaData
    };
  }

  return {
    found: true,
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
  res.json({
    status: "ok",
    name: "Keepa Proxy API"
  });
});

app.get("/lookup", checkAuth, async (req, res) => {
  try {
    const domain = Number(req.query.domain || 9);
    const identifier = String(req.query.identifier || "").trim();

    let asin = null;
    let resolvedFrom = null;

    if (!resolvedFrom.found || !resolvedFrom.asin) {
  return res.status(200).json({
    found: false,
    code: identifier,
    domain,
    message: "No se pudo resolver el código a ASIN. Revisa que el ASIN esté puesto en manualMap dentro de server.js.",
    resolvedFrom
  });
}
      asin = resolvedFrom.asin;
    } else {
      return res.status(400).json({
        found: false,
        message: "Identificador inválido. Usa ASIN o EAN/GTIN/UPC/ISBN"
      });
    }

    const keepaData = await callKeepaByAsin(domain, asin);
    const simplified = simplifyKeepaProduct(keepaData);

   if (!simplified.found) {
  return res.status(200).json(simplified);
}

    return res.json({
      ...simplified,
      resolvedFrom
    });
  } catch (error) {
    return res.status(500).json({
      found: false,
      message: "Error en lookup",
      detail: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Keepa proxy running on port ${PORT}`);
});
