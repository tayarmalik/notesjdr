import { onShowTablesVirtuelles } from './js/canvas-module.js';

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');

  const page = document.getElementById(pageId);
  if (!page) return;

  page.style.display = 'flex';

  // ? AJOUT CRITIQUE
  if (pageId === 'tables-virtuelles') {
    onShowTablesVirtuelles();
  }
}