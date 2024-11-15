let addresses = [];
let map, routeLayer;
let geocodedAddresses = [];
let startAddressIndex = null;
let endAddressIndex = null;

document.addEventListener("DOMContentLoaded", () => {
  // Inicializar mapa
  map = L.map("map").setView([-23.5505, -46.6333], 12); // São Paulo
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);

  // Adicionar event listeners aos botões
  document.getElementById("add-address-btn").addEventListener("click", addAddress);
  document.getElementById("calculate-route-btn").addEventListener("click", calculateOptimizedRoute);
  document.getElementById("recalculate-route-btn").addEventListener("click", recalculateRoute);
  document.getElementById("open-maps-btn").addEventListener("click", openRouteInGoogleMaps);
  routeLayer.clearLayers();
});

// Função para geocodificar um endereço
async function geocodeAddress(address) {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
      if (!response.ok) throw new Error("Erro ao acessar a API de geocodificação.");
  
      const data = await response.json();
      if (data.length === 0) {
        alert(`Endereço não encontrado: ${address}`);
        return null;
      }
  
      const result = data[0];
      console.log(`Endereço geocodificado: ${result.display_name}`);
      return {
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
        display_name: result.display_name,
      };
    } catch (error) {
      console.error(`Erro na geocodificação do endereço ${address}:`, error);
      alert(`Erro ao processar o endereço: ${address}.`);
      return null;
    }
  }

// Adicionar endereço à lista
async function addAddress() {
  const cep = document.getElementById("cep").value.trim();
  const number = document.getElementById("number").value.trim();
  const address = document.getElementById("address").value.trim();

  if (!cep && !address) {
    alert("Por favor, insira um CEP ou endereço.");
    return;
  }

  let fullAddress;
  if (cep) {
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!response.ok) {
        alert("CEP inválido ou não encontrado.");
        return;
      }
      const data = await response.json();
      if (data.erro) {
        alert("CEP não encontrado.");
        return;
      }
      fullAddress = `${data.logradouro}, ${number}, ${data.localidade}`;
    } catch (error) {
      alert("Erro ao buscar o endereço pelo CEP.");
      console.error(error);
      return;
    }
  } else {
    fullAddress = `${address}, ${number}`;
  }

  addresses.push(fullAddress);
  updateAddressList();
  document.getElementById("cep").value = "";
  document.getElementById("number").value = "";
  document.getElementById("address").value = "";
}

// Atualizar lista de endereços na interface
function updateAddressList() {
  const list = document.getElementById("address-list");
  list.innerHTML = addresses
    .map((addr, index) => `
      <li>
        <input type="checkbox" onchange="setStartOrEnd(${index}, 'start')" ${index === startAddressIndex ? "checked" : ""}> Partida
        <input type="checkbox" onchange="setStartOrEnd(${index}, 'end')" ${index === endAddressIndex ? "checked" : ""}> Retorno
        ${addr} 
        <button onclick="removeAddress(${index})">Remover</button>
      </li>
    `)
    .join("");
}

// Definir partida ou retorno com checkbox
function setStartOrEnd(index, type) {
  if (type === 'start') {
    startAddressIndex = index;
    if (endAddressIndex === index) endAddressIndex = null; // Evitar partida e retorno no mesmo endereço
  } else if (type === 'end') {
    endAddressIndex = index;
    if (startAddressIndex === index) startAddressIndex = null; // Evitar partida e retorno no mesmo endereço
  }
  updateAddressList();
}

// Remover endereço da lista
function removeAddress(index) {
  addresses.splice(index, 1);
  if (index === startAddressIndex) startAddressIndex = null;
  if (index === endAddressIndex) endAddressIndex = null;
  updateAddressList();
}

async function calculateOptimizedRoute() {
    if (addresses.length < 1) {
        alert("Você precisa adicionar ao menos um endereço para calcular a rota.");
        return;
    }

    // Verificar se a lista contém endereços duplicados
    const uniqueAddresses = [...new Set(addresses)];
    if (uniqueAddresses.length !== addresses.length) {
        alert("Há endereços duplicados na lista. Remova as duplicatas antes de continuar.");
        return;
    }

    const startAddress = startAddressIndex !== null ? addresses[startAddressIndex] : null;
    const endAddress = endAddressIndex !== null ? addresses[endAddressIndex] : null;

    if (!startAddress) {
        alert("Defina um ponto de partida antes de calcular a rota.");
        return;
    }

    const intermediateAddresses = addresses.filter((_, index) => index !== startAddressIndex && index !== endAddressIndex);

    const orderedIntermediateAddresses = intermediateAddresses.map((address, index) => {
        const orderValue = parseInt(document.getElementById(`order-${index}`)?.value);
        return { address, order: isNaN(orderValue) ? null : orderValue };
    }).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

    const addressesToGeocode = endAddress
        ? [startAddress, ...orderedIntermediateAddresses.map(({ address }) => address), endAddress]
        : [startAddress, ...orderedIntermediateAddresses.map(({ address }) => address)];

    geocodedAddresses = await Promise.all(addressesToGeocode.map(geocodeAddress));

    if (geocodedAddresses.includes(null)) {
        alert("Não foi possível geocodificar todos os endereços.");
        return;
    }

    // Construir as coordenadas para a API
    const coords = geocodedAddresses.map(coord => [coord.lon, coord.lat]);

    try {
        const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "5b3ce3597851110001cf6248e34f1271c61a47a6825e91a262ad2cbd",
            },
            body: JSON.stringify({ coordinates: coords }),
        });

        if (!response.ok) {
            console.error("Erro na API OpenRouteService:", await response.text());
            alert("Erro ao calcular a rota. Verifique os endereços.");
            return;
        }

        const data = await response.json();

        // Verificar a estrutura da resposta
        if (!data.features || data.features.length === 0) {
            console.error("Dados inválidos ou vazios na resposta da API:", data);
            alert("Erro ao processar os dados da rota. Verifique os endereços.");
            return;
        }

        // Acessar as coordenadas da geometria
        const routeCoords = data.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        const distance = (data.features[0].properties.summary.distance / 1000).toFixed(2);
        const duration = (data.features[0].properties.summary.duration / 60).toFixed(2);

        // Atualizar o resumo da rota na interface
        document.getElementById("summary").innerText = `Distância Total: ${distance} km | Tempo Estimado: ${duration} min`;

        // Limpar camadas anteriores e adicionar nova rota
        routeLayer.clearLayers();
        L.polyline(routeCoords, { color: "blue", weight: 5 }).addTo(routeLayer);

        // Adicionar marcadores para cada ponto de parada com números
        geocodedAddresses.forEach((geocodedPoint, index) => {
            if (!geocodedPoint) return; // Ignorar pontos inválidos
        
            const marker = L.marker([geocodedPoint.lat, geocodedPoint.lon], {
                icon: L.divIcon({
                    className: 'numbered-marker',
                    html: `<div>${index + 1}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15],
                }),
            }).addTo(routeLayer);
        
            // Adicionar popup com o nome da rua
            marker.bindPopup(`<strong>Endereço:</strong> ${geocodedPoint.display_name}`).openPopup();
        });
        

        // Ajustar o mapa para se ajustar a todos os pontos da rota e os marcadores
        const allLayersBounds = L.latLngBounds([]);
        routeLayer.eachLayer(layer => {
            if (layer instanceof L.Polyline) {
                allLayersBounds.extend(layer.getBounds());
            } else if (layer instanceof L.Marker) {
                allLayersBounds.extend(layer.getLatLng());
            }
        });

        map.fitBounds(allLayersBounds);
    } catch (error) {
        alert("Erro ao calcular a rota.");
        console.error(error);
    }
}

  // Recalcular Melhor Rota (tenta otimizar novamente)
  function recalculateRoute() {
    calculateOptimizedRoute();
  }
  
  // Abrir Rota no Google Maps
  function openRouteInGoogleMaps() {
    if (addresses.length === 0) {
      alert("Você precisa adicionar endereços antes de abrir no Google Maps.");
      return;
    }
  
    // Mesma lógica para obter a lista ordenada de endereços que está sendo usada no cálculo da rota
    const startAddress = startAddressIndex !== null ? addresses[startAddressIndex] : addresses[0];
    const endAddress = endAddressIndex !== null ? addresses[endAddressIndex] : null;
    const intermediateAddresses = addresses
      .map((address, index) => {
        const orderValue = parseInt(document.getElementById(`order-${index}`).value);
        return {
          address,
          index,
          order: isNaN(orderValue) ? null : orderValue,
        };
      })
      .filter(({ index }) => index !== startAddressIndex && index !== endAddressIndex);
  
    // Ordenar as paradas intermediárias com base na ordem especificada pelo usuário
    intermediateAddresses.sort((a, b) => {
      if (a.order === null && b.order === null) return 0;
      if (a.order === null) return 1;
      if (b.order === null) return -1;
      return a.order - b.order;
    });
  
    // Construir a lista final de endereços a serem incluídos na URL do Google Maps
    const addressesToMap = endAddress
      ? [startAddress, ...intermediateAddresses.map(({ address }) => address), endAddress]
      : [startAddress, ...intermediateAddresses.map(({ address }) => address)];
  
    let mapsLink = "https://www.google.com/maps/dir/";
  
    addressesToMap.forEach((address) => {
      mapsLink += `${encodeURIComponent(address)}/`;
    });
  
    // Abrir a rota em uma nova aba do navegador
    window.open(mapsLink, "_blank");
  }
  
  // Atualizar lista de endereços na interface
  function updateAddressList() {
    const list = document.getElementById("address-list");
    list.innerHTML = addresses
      .map((addr, index) => `
        <li>
          <input type="checkbox" onchange="setStartOrEnd(${index}, 'start')" ${index === startAddressIndex ? "checked" : ""}> Partida
          <input type="checkbox" onchange="setStartOrEnd(${index}, 'end')" ${index === endAddressIndex ? "checked" : ""}> Retorno
          Ordem: <input type="number" id="order-${index}" min="1" placeholder="Ordem">
          ${addr} 
          <button onclick="removeAddress(${index})">Remover</button>
        </li>
      `)
      .join("");
  }

  L.marker([point.lat, point.lon], {
    icon: L.divIcon({
        className: 'numbered-marker',
        html: `<div>${index + 1}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
    }),
}).addTo(routeLayer);

// rastreamento 

let currentPositionMarker;
let routePolyline;
let completedRoutePolyline;
let userPath = [];
let currentRouteIndex = 0;

// Iniciar rota
document.getElementById("start-route-btn").addEventListener("click", startRoute);

function startRoute() {
    if (!geocodedAddresses || geocodedAddresses.length < 2) {
        alert("Adicione ao menos dois endereços e calcule a rota primeiro.");
        return;
    }

    // Pegar localização em tempo real
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(updateUserLocation, showError, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000,
        });
    } else {
        alert("Geolocalização não é suportada pelo seu navegador.");
    }
}

// Atualizar a localização do usuário em tempo real
function updateUserLocation(position) {
    const { latitude, longitude } = position.coords;

    // Atualizar marcador da posição atual
    if (!currentPositionMarker) {
        currentPositionMarker = L.marker([latitude, longitude], {
            icon: L.divIcon({
                className: 'numbered-marker',
                html: '<div>Você</div>',
                iconSize: [30, 30],
                iconAnchor: [15, 15],
            }),
        }).addTo(map);
    } else {
        currentPositionMarker.setLatLng([latitude, longitude]);
    }

    // Adicionar o ponto ao caminho percorrido
    userPath.push([latitude, longitude]);

    // Atualizar a rota percorrida
    if (completedRoutePolyline) {
        completedRoutePolyline.setLatLngs(userPath);
    } else {
        completedRoutePolyline = L.polyline(userPath, { color: 'gray', weight: 5 }).addTo(map);
    }

    // Atualizar o mapa para seguir a posição do usuário
    map.setView([latitude, longitude], 15);

    // Verificar se o usuário chegou no próximo ponto da rota
    if (currentRouteIndex < geocodedAddresses.length) {
        const target = geocodedAddresses[currentRouteIndex];
        const distanceToNextPoint = map.distance([latitude, longitude], [target.lat, target.lon]);

        if (distanceToNextPoint < 50) {
            currentRouteIndex++;
            alert(`Você chegou ao ponto ${currentRouteIndex}.`);
        }
    }
}

// Mostrar erros de localização
function showError(error) {
    console.error("Erro ao obter localização:", error.message);
    alert("Não foi possível obter sua localização. Verifique as permissões do navegador.");
}

// Desenhar a rota completa no mapa
function drawRoute() {
    const routeCoords = geocodedAddresses.map(point => [point.lat, point.lon]);
    if (routePolyline) {
        routePolyline.setLatLngs(routeCoords);
    } else {
        routePolyline = L.polyline(routeCoords, { color: 'blue', weight: 5 }).addTo(map);
    }
}