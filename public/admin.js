(function () {
  const fileInput = document.getElementById("file-input");
  const payload = document.getElementById("pasted-rows");
  const tableBody = document.querySelector("#dataTable tbody");
  const log = document.getElementById("log");

  if (!fileInput || !payload || !tableBody || !log) return;

  function parseCsvLine(line) {
    const values = [];
    let current = "";
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);
    return values.map((value) => value.trim());
  }

  function parseRows(text) {
    return String(text || "")
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const delimiter = line.includes("\t") ? "\t" : ",";
        const parts = delimiter === "\t" ? line.split("\t").map((value) => value.trim()) : parseCsvLine(line);
        while (parts.length > 1 && parts[parts.length - 1] === "") {
          parts.pop();
        }
        const phone = parts.shift() || "";
        const message = parts.join(delimiter);
        return { phone, message };
      })
      .filter((row) => {
        return !(/電話|phone/i.test(row.phone) && /文面|message|本文|送信内容/i.test(row.message));
      });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function appendLog(message, isError) {
    const entry = document.createElement("p");
    entry.className = "log-entry" + (isError ? " error-text" : "");
    entry.textContent = message;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  function renderPreview(rows) {
    tableBody.innerHTML = rows
      .map((row) => {
        return [
          "<tr>",
          "<td>", escapeHtml(row.phone), "</td>",
          "<td class=\"message\">", escapeHtml(row.message), "</td>",
          "<td class=\"url-cell\">未生成</td>",
          "<td>CSV読込済み</td>",
          "</tr>"
        ].join("");
      })
      .join("");
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      payload.value = text;
      const rows = parseRows(text);
      renderPreview(rows);
      appendLog(`${rows.length}件のCSVを読み込みました。`);
    };
    reader.onerror = () => {
      appendLog("CSVの読み込みに失敗しました。", true);
    };
    reader.readAsText(file, "UTF-8");
  });
})();
