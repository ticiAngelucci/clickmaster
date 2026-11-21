document.getElementById("btn-open-dashboard").addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard/dashboard.html")
  });
  window.close();
});
