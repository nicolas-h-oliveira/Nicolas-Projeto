/* Note Cine - Sincroniza��o direta via API PHP & Banco de Dados */

const Storage = (() => {

    function getUser() {
        if (typeof getSessionUser === 'function') {
            return getSessionUser();
        }

        try {
            return JSON.parse(localStorage.getItem('notecine_user')) || null;
        } catch {
            return null;
        }
    }

    function maxSlots(role) {
        if (typeof NoteCinePlans !== 'undefined' && NoteCinePlans.maxMovieSlots) {
            return NoteCinePlans.maxMovieSlots(role);
        }

        return 5;
    }

    function parseCompositeId(rawId, defaultType = 'movie') {
        if (!rawId) {
            return {
                id: '',
                media_type: defaultType
            };
        }

        const parts = String(rawId).split(':');

        if (parts.length > 1) {
            return {
                media_type: parts[0],
                id: parts[1]
            };
        }

        return {
            media_type: defaultType,
            id: parts[0]
        };
    }

    /*
     * Normaliza a capa recebida do banco ou do TMDB.
     *
     * Aceita:
     * https://image.tmdb.org/t/p/w500/abc.jpg
     * /abc.jpg
     * abc.jpg
     * /t/p/w500/abc.jpg
     */
    function normalizePosterUrl(poster) {
        if (!poster) {
            return '';
        }

        const value = String(poster).trim();

        if (!value) {
            return '';
        }

        // J� � uma URL completa
        if (/^https?:\/\//i.test(value)) {
            return value;
        }

        // Caminho relativo do TMDB
        if (value.startsWith('/')) {
            if (value.startsWith('/t/p/')) {
                return `https://image.tmdb.org${value}`;
            }

            return `https://image.tmdb.org/t/p/w500${value}`;
        }

        // Caso tenha sido salvo somente o nome/caminho da imagem
        return `https://image.tmdb.org/t/p/w500/${value}`;
    }

    async function checkMovieStatus(movieId, mediaType = 'movie') {
        const parsed = parseCompositeId(movieId, mediaType);
        const compositeId = `${parsed.media_type}:${parsed.id}`;

        try {
            const res = await fetch(
                `api.php?action=check_movie_status&movie_id=${encodeURIComponent(compositeId)}`
            );

            const data = await res.json();

            if (data.success) {
                return {
                    isFavorite: data.is_favorite,
                    inProfile: data.in_profile
                };
            }
        } catch (e) {
            console.error('Erro ao checar status do filme:', e);
        }

        return {
            isFavorite: false,
            inProfile: false
        };
    }

    async function getFavorites(username = '') {
        try {
            const url = username
                ? `api.php?action=get_profile_data&username=${encodeURIComponent(username)}`
                : `api.php?action=get_profile_data`;

            const res = await fetch(url);
            const data = await res.json();

            if (data.success && Array.isArray(data.favorites)) {

                return data.favorites.map(f => {

                    const parsed = parseCompositeId(
                        f.movie_id,
                        f.media_type || 'movie'
                    );

                    /*
                     * O PHP retorna poster_url.
                     * Mantemos tamb�m poster_url e poster_path
                     * para que qualquer componente consiga usar a capa.
                     */
                    const poster = normalizePosterUrl(
                        f.poster_url || f.poster_path || f.poster || ''
                    );

                    return {
                        id: parsed.id,
                        media_type: parsed.media_type,
                        title: f.title || 'Sem t�tulo',

                        poster: poster,
                        poster_url: poster,
                        poster_path: poster,

                        composite_id: `${parsed.media_type}:${parsed.id}`
                    };
                });
            }
        } catch (e) {
            console.error('Erro ao buscar favoritos:', e);
        }

        return [];
    }

    async function getProfileMovies(username = '') {
        try {
            const url = username
                ? `api.php?action=get_profile_data&username=${encodeURIComponent(username)}`
                : `api.php?action=get_profile_data`;

            const res = await fetch(url);
            const data = await res.json();

            if (data.success && Array.isArray(data.top_movies)) {
                // ENRIQUECIMENTO: Buscar cada filme na API TMDB
                const enrichedMovies = await Promise.all(data.top_movies.map(async (m) => {
                    const parsed = parseCompositeId(m.movie_id, m.media_type || 'movie');
                    
                    try {
                        const tmdbData = await tmdbFetch(buildUrl(`/${parsed.media_type}/${parsed.id}`));
                        
                        if (!tmdbData || tmdbData.success === false) throw new Error();

                        const posterPath = tmdbData.poster_path;
                        const poster = posterPath ? posterUrl(posterPath, 'w500') : normalizePosterUrl(m.poster_url || m.poster_path || m.poster || '');

                        return {
                            id: parsed.id,
                            media_type: parsed.media_type,
                            title: tmdbData.title || tmdbData.name || m.title || 'Sem t�tulo',
                            poster: poster,
                            poster_url: poster,
                            poster_path: posterPath,
                            composite_id: `${parsed.media_type}:${parsed.id}`,
                            slot_position: parseInt(m.slot_position) || 0,
                            vote_average: tmdbData.vote_average || 0,
                            year: extractYear(tmdbData.release_date || tmdbData.first_air_date) || ''
                        };
                    } catch {
                        // Fallback
                        const fallbackPoster = normalizePosterUrl(m.poster_url || m.poster_path || m.poster || '');
                        return {
                            id: parsed.id,
                            media_type: parsed.media_type,
                            title: m.title || 'Sem t�tulo',
                            poster: fallbackPoster,
                            poster_url: fallbackPoster,
                            poster_path: fallbackPoster,
                            composite_id: `${parsed.media_type}:${parsed.id}`,
                            slot_position: parseInt(m.slot_position) || 0
                        };
                    }
                }));
                return enrichedMovies;
            }
        } catch (e) {
            console.error('Erro ao buscar filmes do perfil:', e);
        }

        return [];
    }

    async function isFavorite(id, type = 'movie') {
        const status = await checkMovieStatus(id, type);
        return status.isFavorite;
    }

    async function isInProfile(id, type = 'movie') {
        const status = await checkMovieStatus(id, type);
        return status.inProfile;
    }

    // ============================================================
    // FAVORITOS
    // ============================================================

    async function toggleFavorite(item) {

        if (!item) {
            alert('Erro: O item do filme n�o foi carregado corretamente.');

            return {
                ok: false,
                msg: 'Item inv�lido.'
            };
        }

        const rawId =
            item.id ||
            item.composite_id ||
            item.movie_id;

        const parsed = parseCompositeId(
            rawId,
            item.media_type || 'movie'
        );

        const compositeId =
            `${parsed.media_type}:${parsed.id}`;

        let poster = '';

        if (item.poster) {
            poster = normalizePosterUrl(item.poster);
        } else if (item.poster_url) {
            poster = normalizePosterUrl(item.poster_url);
        } else if (item.poster_path) {
            poster = normalizePosterUrl(item.poster_path);
        }

        const formData = new FormData();

        formData.append('movie_id', compositeId);
        formData.append(
            'title',
            item.title || item.name || 'Sem T�tulo'
        );
        formData.append('poster_url', poster);
        formData.append('poster_path', poster);
        formData.append('media_type', parsed.media_type);

        try {

            const res = await fetch(
                'api.php?action=toggle_favorite',
                {
                    method: 'POST',
                    body: formData
                }
            );

            const data = await res.json();

            console.log(
                'Servidor Respondeu (Favoritos):',
                data
            );

            if (!data.success) {
                alert(
                    'Resposta do Servidor: ' +
                    (data.message || 'Erro desconhecido')
                );
            }

            return {
                ok: data.success,
                added: data.is_favorite,
                msg: data.message
            };

        } catch (e) {

            console.error(
                'Erro na requisi��o dos favoritos:',
                e
            );

            alert(
                'Erro ao conectar com o servidor api.php'
            );

            return {
                ok: false,
                msg: 'Erro de conex�o com o servidor.'
            };
        }
    }

    // ============================================================
    // PERFIL
    // ============================================================

    async function toggleProfileMovie(item) {

        if (!item) {
            alert(
                'Erro: O item do filme n�o foi carregado corretamente.'
            );

            return {
                ok: false,
                msg: 'Item inv�lido.'
            };
        }

        const rawId =
            item.id ||
            item.composite_id ||
            item.movie_id;

        const parsed = parseCompositeId(
            rawId,
            item.media_type || 'movie'
        );

        const compositeId =
            `${parsed.media_type}:${parsed.id}`;

        let poster = '';

        if (item.poster) {
            poster = normalizePosterUrl(item.poster);
        } else if (item.poster_url) {
            poster = normalizePosterUrl(item.poster_url);
        } else if (item.poster_path) {
            poster = normalizePosterUrl(item.poster_path);
        }

        const status = await checkMovieStatus(
            compositeId,
            parsed.media_type
        );

        const actionName =
            status.inProfile
                ? 'remove_top_movie'
                : 'add_top_movie';

        const formData = new FormData();

        formData.append(
            'movie_id',
            compositeId
        );

        formData.append(
            'title',
            item.title || item.name || 'Sem T�tulo'
        );

        formData.append(
            'poster_url',
            poster
        );

        formData.append(
            'poster_path',
            poster
        );

        formData.append(
            'media_type',
            parsed.media_type
        );

        try {

            const res = await fetch(
                `api.php?action=${actionName}`,
                {
                    method: 'POST',
                    body: formData
                }
            );

            const data = await res.json();

            console.log(
                `Servidor Respondeu (${actionName}):`,
                data
            );

            if (!data.success) {
                alert(
                    'Resposta do Servidor: ' +
                    (data.message || 'Erro desconhecido')
                );
            }

            return {
                ok: data.success,
                added: !status.inProfile,
                msg: data.message
            };

        } catch (e) {

            console.error(
                'Erro na requisi��o do perfil:',
                e
            );

            alert(
                'Erro ao conectar com o servidor api.php'
            );

            return {
                ok: false,
                msg: 'Erro de conex�o com o servidor.'
            };
        }
    }

    // ============================================================
    // NORMALIZA��O DE ITEM
    // ============================================================

    function normalizeItem(item) {

        const parsed = parseCompositeId(
            item.id || item.composite_id,
            item.media_type || 'movie'
        );

        let poster = '';

        if (item.poster) {
            poster = normalizePosterUrl(item.poster);
        } else if (item.poster_url) {
            poster = normalizePosterUrl(item.poster_url);
        } else if (item.poster_path) {
            poster = normalizePosterUrl(item.poster_path);
        }

        return {
            id: parsed.id,

            title:
                item.title ||
                item.name ||
                'Sem t�tulo',

            poster: poster,
            poster_url: poster,
            poster_path: poster,

            rating:
                item.rating ||
                (
                    item.vote_average
                        ? item.vote_average.toFixed(1)
                        : 'N/A'
                ),

            media_type: parsed.media_type,

            year: item.year || '',

            runtime:
                item.runtime || null,

            genres:
                item.genres || []
        };
    }

    // ============================================================
    // REVIEWS
    // ============================================================

    async function getReviews(username = '') {

        try {

            const target = username
                ? `&username=${encodeURIComponent(username)}`
                : '';

            const res = await fetch(
                `api.php?action=get_profile_data${target}`
            );

            const data = await res.json();

            if (data.success && data.reviews) {
                return data.reviews;
            }

        } catch {
            return [];
        }

        return [];
    }

    async function getMovieReviews(
        movieId,
        type = 'movie'
    ) {

        const parsed = parseCompositeId(
            movieId,
            type
        );

        const compId =
            `${parsed.media_type}:${parsed.id}`;

        try {

            const response = await fetch(
                `api.php?action=get_movie_reviews&movie_id=${encodeURIComponent(compId)}`
            );

            const data = await response.json();

            if (data.success) {
                return data.reviews;
            }

        } catch {
            return [];
        }

        return [];
    }

    async function addReview(
        movieId,
        movieType,
        title,
        text,
        rating
    ) {

        const parsed = parseCompositeId(
            movieId,
            movieType
        );

        const compositeId =
            `${parsed.media_type}:${parsed.id}`;

        const formData = new FormData();

        formData.append(
            'movie_id',
            compositeId
        );

        formData.append(
            'media_type',
            parsed.media_type
        );

        formData.append(
            'rating',
            String(rating)
        );

        formData.append(
            'title',
            title.trim()
        );

        formData.append(
            'text',
            text.trim()
        );

        try {

            const res = await fetch(
                'api.php?action=add_review',
                {
                    method: 'POST',
                    body: formData,
                    credentials: 'same-origin'
                }
            );

            const raw = await res.text();
            let data;

            try {
                data = JSON.parse(raw);
            } catch {
                console.error('Resposta inv�lida ao salvar cr�tica:', raw);
                return {
                    ok: false,
                    msg: 'O servidor n�o retornou um JSON v�lido ao salvar a cr�tica.'
                };
            }

            return {
                ok: !!data.success,
                msg: data.message || (data.success ? 'Cr�tica publicada.' : 'Erro ao salvar cr�tica no banco de dados.')
            };

        } catch (err) {

            console.error('Falha de rede ao salvar cr�tica:', err);
            return {
                ok: false,
                msg: 'N�o foi poss�vel conectar ao servidor para salvar a cr�tica.'
            };
        }
    }

    async function updateReview(
        id,
        title,
        text,
        rating
    ) {

        const formData = new FormData();

        formData.append('id', id);
        formData.append('rating', rating);
        formData.append('title', title.trim());
        formData.append('text', text.trim());

        try {

            const res = await fetch(
                'api.php?action=update_review',
                {
                    method: 'POST',
                    body: formData,
                    credentials: 'same-origin'
                }
            );

            const raw = await res.text();
            let data;

            try {
                data = JSON.parse(raw);
            } catch {
                return {
                    ok: false,
                    msg: 'O servidor n�o retornou um JSON v�lido ao atualizar a cr�tica.'
                };
            }

            return {
                ok: !!data.success,
                msg: data.message || 'Erro ao atualizar cr�tica.'
            };

        } catch (err) {

            console.error('Falha de rede ao atualizar cr�tica:', err);
            return {
                ok: false,
                msg: 'N�o foi poss�vel conectar ao servidor para atualizar a cr�tica.'
            };
        }
    }

    async function deleteReview(id) {

        const formData = new FormData();

        formData.append('id', id);

        try {

            const res = await fetch(
                'api.php?action=delete_review',
                {
                    method: 'POST',
                    body: formData,
                    credentials: 'same-origin'
                }
            );

            const data = await res.json();

            return {
                ok: data.success,
                msg: data.message
            };

        } catch {

            return {
                ok: false,
                msg: 'Erro ao excluir cr�tica.'
            };
        }
    }

    return {
        getUser,
        maxSlots,
        parseCompositeId,
        normalizePosterUrl,

        checkMovieStatus,

        getFavorites,
        getProfileMovies,

        isFavorite,
        isInProfile,

        toggleFavorite,
        toggleProfileMovie,

        normalizeItem,

        getReviews,
        getMovieReviews,

        addReview,
        updateReview,
        deleteReview
    };

})();