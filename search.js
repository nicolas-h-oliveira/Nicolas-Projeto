/* Note Cine - Busca em tempo real com TMDB e usuarios */
function setupSearch() {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    if (!input || !results) return;

    let activeIndex = -1;
    let currentResults = [];
    let currentUsers = [];

    const doSearch = debounce(async (query) => {
        const q = query.trim();
        if (q.length < 1) {
            results.style.display = 'none';
            results.innerHTML = '';
            return;
        }

        results.style.display = 'block';
        results.innerHTML = `<div class="search-loading"><div class="search-skeleton"><div class="sk-img skeleton"></div><div class="sk-text"><div class="sk-line skeleton" style="height:14px;width:70%"></div><div class="sk-line skeleton" style="height:10px;width:40%"></div></div></div></div>`;

        try {
            const [tmdbData, usersData] = await Promise.all([
                tmdbFetch(buildUrl('/search/multi', { query: q })).catch(() => ({ results: [] })),
                fetch('api.php?action=search_users&query=' + encodeURIComponent(q))
                    .then(r => r.json())
                    .catch(() => ({ success: false, users: [] }))
            ]);

            currentResults = (tmdbData.results || [])
                .filter(r => r.type === 'filme' || r.type === 'serie' || r.type === 'anime')
                .slice(0, 6);

            currentUsers = (usersData.users || []).slice(0, 3);
            activeIndex = -1;

            if (currentResults.length === 0 && currentUsers.length === 0) {
                results.innerHTML = '<div class="search-empty">Nenhum resultado encontrado.</div>';
                return;
            }

            let html = '';

            // Secao de Filmes/Series/Animes
            if (currentResults.length > 0) {
                html += '<div class="search-section"><div class="search-section-title">Resultados</div>';
                currentResults.forEach(item => {
                    const title = item.title || item.name || 'Sem titulo';
                    const poster = posterUrl(item.poster_path, 'w342');
                    const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
                    const year = extractYear(item.release_date || item.first_air_date) || '';

                    let displayType = 'Filme';
                    if (item.type === 'serie') displayType = 'Serie';
                    if (item.type === 'anime') displayType = 'Anime';

                    const yearStr = year ? ' &bull; ' + year : '';

                    html += '<div class="search-item search-movie-item" data-type="' + escapeHtml(item.type) + '" data-id="' + escapeHtml(String(item.id)) + '">'
                          + '<img src="' + escapeHtmlAttribute(poster) + '" alt="' + escapeHtmlAttribute(title) + '" loading="lazy">'
                          + '<div class="search-item-info">'
                          + '<h5>' + escapeHtml(title) + '</h5>'
                          + '<span>&#9733; ' + escapeHtml(rating) + yearStr + ' &bull; ' + displayType + '</span>'
                          + '</div>'
                          + '</div>';
                });
                html += '</div>';
            }

            // Secao de Usuarios
            if (currentUsers.length > 0) {
                html += '<div class="search-section"><div class="search-section-title">Usuarios</div>';
                currentUsers.forEach(user => {
                    const avatar = user.avatar_url
                        || 'https://via.placeholder.com/44x44?text=' + encodeURIComponent((user.username || 'U').charAt(0).toUpperCase());
                    const filmLabel = user.movie_count === 1 ? 'filme' : 'filmes';
                    const favLabel = user.fav_count === 1 ? 'favorito' : 'favoritos';

                    html += '<div class="search-item search-user-item" data-type="user" data-username="' + escapeHtmlAttribute(user.username) + '">'
                          + '<img src="' + escapeHtmlAttribute(avatar) + '" alt="' + escapeHtmlAttribute(user.username) + '" loading="lazy" class="search-user-avatar">'
                          + '<div class="search-item-info">'
                          + '<h5>@' + escapeHtml(user.username) + '</h5>'
                          + '<span class="search-user-stats">' + user.movie_count + ' ' + filmLabel + ' &middot; ' + user.fav_count + ' ' + favLabel + '</span>'
                          + '</div>'
                          + '</div>';
                });
                html += '</div>';
            }

            results.innerHTML = html;

            // Event listeners nos itens de filme/serie/anime
            results.querySelectorAll('.search-movie-item').forEach(el => {
                el.addEventListener('click', () => {
                    const id = el.dataset.id;
                    const type = el.dataset.type;
                    results.style.display = 'none';
                    input.value = '';
                    openMovieDetails(id, type);
                });
            });

            // Event listeners nos itens de usuario
            results.querySelectorAll('.search-user-item').forEach(el => {
                el.addEventListener('click', () => {
                    const username = el.dataset.username;
                    results.style.display = 'none';
                    input.value = '';
                    window.location.href = 'perfil.html?username=' + encodeURIComponent(username);
                });
            });

        } catch (err) {
            console.error('Search error:', err);
            results.innerHTML = '<div class="search-empty">Erro ao buscar. Tente novamente.</div>';
        }
    }, 200);

    // Busca em tempo real a cada tecla digitada
    input.addEventListener('input', (e) => doSearch(e.target.value.trim()));

    // Navegacao com teclado
    input.addEventListener('keydown', (e) => {
        const items = results.querySelectorAll('.search-item');
        if (!items.length || results.style.display === 'none') return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = Math.min(activeIndex + 1, items.length - 1);
            updateFocus(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            updateFocus(items);
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            items[activeIndex].click();
        } else if (e.key === 'Escape') {
            results.style.display = 'none';
            input.blur();
        }
    });

    function updateFocus(items) {
        items.forEach((el, i) => el.classList.toggle('focused', i === activeIndex));
        if (items[activeIndex]) {
            items[activeIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    // Fecha ao clicar fora
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !results.contains(e.target)) {
            results.style.display = 'none';
        }
    });

    // Reabre se ja tinha resultado
    input.addEventListener('focus', () => {
        if ((currentResults.length || currentUsers.length) && input.value.trim()) {
            results.style.display = 'block';
        }
    });

    // Inicializa a busca ao carregar a pagina
    if (typeof setupSearch._initialized === 'undefined') {
        setupSearch._initialized = true;
        setupSearch();
    }
}
