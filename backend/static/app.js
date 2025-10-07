// ======= CatalogBuddy Frontend Logic =======

// Elements
const uploadInput = document.getElementById("csvUpload");
const templateSelect = document.getElementById("templateSelect");
const mapBtn = document.getElementById("mapButton");
const transformBtn = document.getElementById("transformButton");
const mappingContainer = document.getElementById("mappingContainer");
const textCleanupCheckbox = document.getElementById("textCleanup");
const logArea = document.getElementById("log");

// State
let selectedFile = null;
let templates = [];
let selectedTemplate = null;
let mapping = {};

// Utility
function log(msg) {
  console.log(msg);
  if (logArea) logArea.innerText += msg + "\n";
}

// ======= 1️⃣ Load Templates on Startup =======
async function loadTemplates() {
  try {
    const res = await fetch("/templates");
    if (!res.ok) throw new Error("Failed to load templates");
    const data = await res.json();
    templates = data.templates || [];
    if (!templates.length) {
      log("⚠️ No templates found on server.");
      return;
    }

    // Populate dropdown
    templateSelect.innerHTML = "";
    templates.forEach((tpl) => {
      const opt = document.createElement("option");
      opt.value = tpl.templateKey;
      opt.textContent = tpl.templateKey;
      templateSelect.appendChild(opt);
    });
    log("✅ Templates loaded.");
  } catch (err) {
    log("❌ Error loading templates: " + err.message);
  }
}

// ======= 2️⃣ File Upload Handling =======
uploadInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file && typeof file.name === "string" && file.name.toLowerCase().endsWith(".csv")) {
    selectedFile = file;
    log(`📁 Selected file: ${file.name}`);
  } else {
    selectedFile = null;
    log("⚠️ Please select a valid .csv file");
  }
});

// ======= 3️⃣ Template Selection =======
templateSelect.addEventListener("change", (e) => {
  const key = e.target.value;
  selectedTemplate = templates.find((t) => t.templateKey === key);
  if (!selectedTemplate) {
    log("⚠️ Template not found!");
    return;
  }
  log(`🧩 Selected template: ${selectedTemplate.templateKey}`);
});

// ======= 4️⃣ Mapping UI Setup =======
mapBtn.addEventListener("click", async () => {
  if (!selectedTemplate) return log("⚠️ Select a template first!");

  mappingContainer.innerHTML = "";
  const headerList = [
    "Handle", "Title", "Body (HTML)", "Vendor", "Type",
    "Tags", "Published", "Option1 Value", "Option2 Value", "Option3 Value",
    "Variant SKU", "Variant Price", "Image Src"
  ];

  selectedTemplate.fields.forEach((f) => {
    const div = document.createElement("div");
    div.classList.add("map-row");

    const lbl = document.createElement("label");
    lbl.textContent = f.label;

    const sel = document.createElement("select");
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "-- Select Shopify Field --";
    sel.appendChild(none);

    headerList.forEach((h) => {
      const opt = document.createElement("option");
      opt.value = h;
      opt.textContent = h;
      sel.appendChild(opt);
    });

    sel.addEventListener("change", (ev) => {
      mapping[f.key] = ev.target.value;
    });

    div.appendChild(lbl);
    div.appendChild(sel);
    mappingContainer.appendChild(div);
  });

  log("🧭 Mapping table ready.");
});

// ======= 5️⃣ Transform Button =======
transformBtn.addEventListener("click", async () => {
  if (!selectedFile) return log("⚠️ Please upload a CSV file first.");
  if (!selectedTemplate) return log("⚠️ Select a template first.");

  const textCleanup = textCleanupCheckbox?.checked
    ? JSON.stringify({ columns: ["Title", "Body (HTML)", "Vendor", "Type"] })
    : "";

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("templateKey", selectedTemplate.templateKey);
  formData.append("mapping", JSON.stringify(mapping));
  formData.append("textCleanup", textCleanup);
  formData.append("filename", `zilo_export_${Date.now()}.csv`);

  log("🚀 Uploading and transforming...");

  try {
    const res = await fetch("/transform", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Transform failed: ${res.status} - ${msg}`);
    }

    // Download transformed CSV
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedFile.name.replace(".csv", "_transformed.csv");
    a.click();
    log("✅ File transformed successfully!");
  } catch (err) {
    log("❌ Transform failed: " + err.message);
  }
});

// ======= Init =======
window.addEventListener("DOMContentLoaded", loadTemplates);
