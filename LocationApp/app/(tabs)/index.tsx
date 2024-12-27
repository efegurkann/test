declare global {
  interface Global {
    ErrorUtils: {
      setGlobalHandler: (callback: () => void) => void;
    };
  }
}

import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  FlatList,
  Vibration,
  Linking,
} from 'react-native';
import MapView, { Marker, Circle } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getDistance } from 'geolib';
import { Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { LocationObject } from 'expo-location';
import { Audio } from 'expo-av';
import { useAlarm } from '../../context/AlarmContext';

const { width, height } = Dimensions.get('window');

if ((global as any).ErrorUtils) {
  (global as any).ErrorUtils.setGlobalHandler(() => {
    // Hata işleme
  });
}

if (__DEV__) {
  const consoleTemp = { ...console };
  (Object.keys(console) as (keyof Console)[]).forEach(key => {
    // @ts-ignore
    console[key] = () => {};
  });
  // Sadece log'ları görmek istiyorsanız
  console.log = consoleTemp.log;
}

interface LocationState {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

interface DestinationState {
  latitude: number;
  longitude: number;
  name: string;
  address?: string;
  website?: string;
}

interface SearchResult {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
}

interface ActiveAlarm {
  id: string;
  location: DestinationState;
  radius: number;
  isActive: boolean;
}

interface Alarm {
  id: string;
  location: {
    latitude: number;
    longitude: number;
    name: string;
  };
  radius: number;
  isActive: boolean;
  createdAt: string;
}

interface CircleState {
  center: {
    latitude: number;
    longitude: number;
  };
  radius: number;
}

// Sabit tanımlaması - dosyanın en üstünde olmalı
const LOCATION_TASK_NAME = 'background-location-task';
let isVibrating = false;

// Bildirimleri yapılandıralım
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Task veri tipi tanımlaması
type LocationTaskData = {
  locations: Array<{
    coords: {
      latitude: number;
      longitude: number;
      altitude: number | null;
      accuracy: number;
      altitudeAccuracy: number | null;
      heading: number | null;
      speed: number | null;
    };
    timestamp: number;
  }>;
}

// Mesafe hesaplama fonksiyonu (km cinsinden)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Dünya'nın yarıçapı (km)
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// İzinleri kontrol eden ve isteyen fonksiyon
const checkAndRequestPermissions = async () => {
  try {
    // Konum izinlerini kontrol et
    let { status: foregroundStatus } = await Location.getForegroundPermissionsAsync();
    if (foregroundStatus !== 'granted') {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Konum İzni Gerekli',
          'Uygulamanın çalışması için konum izni vermeniz gerekmektedir.',
          [{ text: 'Ayarlara Git', onPress: () => Linking.openSettings() }],
          { cancelable: false }
        );
        return false;
      }
    }

    // Android için arka plan konum izni
    if (Platform.OS === 'android') {
      let { status: backgroundStatus } = await Location.getBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        const { status } = await Location.requestBackgroundPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Arka Plan Konum İzni Gerekli',
            'Alarm özelliğinin çalışması için arka plan konum iznini vermeniz gerekmektedir.',
            [{ text: 'Ayarlara Git', onPress: () => Linking.openSettings() }],
            { cancelable: false }
          );
          return false;
        }
      }
    }

    // Bildirim izinlerini kontrol et
    const { status: notificationStatus } = await Notifications.getPermissionsAsync();
    if (notificationStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Bildirim İzni Gerekli',
          'Alarm bildirimleri için izin vermeniz gerekmektedir.',
          [{ text: 'Ayarlara Git', onPress: () => Linking.openSettings() }],
          { cancelable: false }
        );
        return false;
      }
    }

    // Tüm izinler alındıysa konum takibini başlat
    return true;

  } catch (error) {
    console.error('İzin kontrolü hatası:', error);
    Alert.alert('Hata', 'İzinler kontrol edilirken bir hata oluştu.');
    return false;
  }
};

// Task tanımlaması - component dışında olmalı
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: { data: any; error: any }) => {
  if (error) {
    console.error('Task error:', error);
    return;
  }
  
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    console.log('Received new locations:', locations);
  }
});

export default function HomeScreen() {
  const router = useRouter();
  const [currentLocation, setCurrentLocation] = useState<LocationState | null>(null);
  const [destinationLocation, setDestinationLocation] = useState<DestinationState | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [alarmRadius, setAlarmRadius] = useState<number>(1);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState<boolean>(false);
  const [activeAlarm, setActiveAlarm] = useState<ActiveAlarm | null>(null);
  const [circle, setCircle] = useState<CircleState | null>(null);
  const { isAlarmActive, setIsAlarmActive, alarmSound, setAlarmSound } = useAlarm();

  const mapRef = useRef<MapView>(null);
  const searchTimeout = useRef<NodeJS.Timeout>();

  // Fonksiyonu buraya taşıyın (useEffect'lerden önce)
  const saveCircleToStorage = async (circleData: CircleState) => {
    try {
      await AsyncStorage.setItem('alarmCircle', JSON.stringify(circleData));
    } catch (error) {
      console.error('Circle save error:', error);
    }
  };

  // Circle state'i değiştiğinde storage'a kaydet
  useEffect(() => {
    if (circle) {
      saveCircleToStorage(circle);
    }
  }, [circle]);

  // Ana useEffect
  useEffect(() => {
    let isActive = true;

    const initialize = async () => {
      try {
        if (isActive) {
          const hasPermissions = await checkAndRequestPermissions();
          if (hasPermissions) {
            // Konum takibini başlatma fonksiyonu güncellendi
            const startBackgroundUpdate = async () => {
              try {
                const { status: foreground } = await Location.requestForegroundPermissionsAsync();
                if (foreground !== 'granted') return;

                const { status: background } = await Location.requestBackgroundPermissionsAsync();
                if (background !== 'granted') return;

                await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
                  accuracy: Location.Accuracy.Balanced,
                  timeInterval: 5000,
                  distanceInterval: 10,
                  showsBackgroundLocationIndicator: true,
                  // Arka plan ayarları
                  pausesUpdatesAutomatically: false,
                  activityType: Location.ActivityType.Other,
                  foregroundService: {
                    notificationTitle: "Konum Takibi Aktif",
                    notificationBody: "Konumunuz arka planda takip ediliyor",
                    notificationColor: "#4285F4",
                  },
                });
              } catch (err) {
                console.error('Konum takibi başlatılamadı:', err);
              }
            };

            startBackgroundUpdate();
          }
        }
      } catch (error) {
        console.error('Başlatma hatası:', error);
      }
    };

    initialize();

    return () => {
      isActive = false;
      if (TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
        Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME)
          .catch(error => console.error('Temizleme hatası:', error));
      }
    };
  }, []);

  useEffect(() => {
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Hata', 'Konum izni gerekli');
        return;
      }

      let location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const newLocation = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };

      setCurrentLocation(newLocation);
      mapRef.current?.animateToRegion(newLocation, 1000);
    } catch (error) {
      console.error('Konum alma hatası:', error);
      Alert.alert('Hata', 'Konum alınamadı');
    }
  };

  const searchLocation = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    setShowResults(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          query
        )}&countrycodes=tr&limit=5&addressdetails=1`,
        {
          signal: controller.signal,
          headers: {
            'User-Agent': 'GeoAlarm/1.0',
            'Accept-Language': 'tr'
          }
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setSearchResults(data);
    } catch (error) {
      console.error('Arama hatası:', error);
      Alert.alert('Hata', 'Arama yapılırken bir sorun oluştu');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearch = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }
    searchTimeout.current = setTimeout(() => {
      searchLocation(text);
    }, 500);
  };

  const handleSelectSearchResult = (item: SearchResult) => {
    const newDestination = {
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      name: item.display_name,
    };
    
    setDestinationLocation(newDestination);
    setSearchQuery(item.display_name);
    setShowResults(false);

    mapRef.current?.animateToRegion({
      latitude: newDestination.latitude,
      longitude: newDestination.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }, 500);
  };

  const handleSetAlarm = async () => {
    if (!destinationLocation) {
      Alert.alert('Uyarı', 'Lütfen önce bir konum seçin!');
      return;
    }

    const newAlarm: Alarm = {
      id: Date.now().toString(),
      location: destinationLocation,
      radius: alarmRadius,
      isActive: true,
      createdAt: new Date().toISOString()
    };

    try {
      const alarmsStr = await AsyncStorage.getItem('alarms');
      const alarms: Alarm[] = alarmsStr ? JSON.parse(alarmsStr) : [];
      const updatedAlarms = [...alarms, newAlarm];
      await AsyncStorage.setItem('alarms', JSON.stringify(updatedAlarms));
      
      Alert.alert('Başarılı', 'Alarm başarıyla kaydedildi!');
      router.push('/(tabs)/scheduled-alarms');
    } catch (error: unknown) {
      console.error('Alarm kaydedilemedi:', error);
      Alert.alert('Hata', 'Alarm kaydedilemedi!');
    }
  };

  useEffect(() => {
    if (!currentLocation) return;

    // Kayıtlı alarmları kontrol et
    const checkAlarms = async () => {
      try {
        const alarmsStr = await AsyncStorage.getItem('alarms');
        const alarms: Alarm[] = alarmsStr ? JSON.parse(alarmsStr) : [];
        
        // Aktif alarmları kontrol et
        alarms.forEach(alarm => {
          if (alarm.isActive) {
            const distance = getDistance(
              { latitude: currentLocation.latitude, longitude: currentLocation.longitude },
              { latitude: alarm.location.latitude, longitude: alarm.location.longitude }
            );

            const distanceInKm = distance / 1000;
            console.log('Mesafe:', distanceInKm, 'km');
            console.log('Alarm yarıçap:', alarm.radius, 'km');

            if (distanceInKm <= alarm.radius) {
              console.log('Hedef bölgeye girildi!');
              triggerAlarm();
            }
          }
        });
      } catch (error) {
        console.error('Alarm kontrolü hatası:', error);
      }
    };

    // Her 5 saniyede bir alarmları kontrol et
    const intervalId = setInterval(checkAlarms, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [currentLocation]);

  const triggerAlarm = async () => {
    if (isAlarmActive) return; // Eğer alarm zaten çalıyorsa, yeni alarm başlatma
    
    try {
      setIsAlarmActive(true);
      // Titreşim başlat
      Vibration.vibrate(Pattern.ALARM, true);

      // Ses çal
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/alarm.mp3'),
        { shouldPlay: true, isLooping: true }
      );
      setAlarmSound(sound);

      Alert.alert(
        'Hedefe Ulaştınız!',
        'Hedefinize yaklaştınız.',
        [
          {
            text: 'Tamam',
            style: 'cancel',
          },
        ],
        { cancelable: true }
      );
    } catch (error) {
      console.error('Alarm çalma hatası:', error);
    }
  };

  const stopAlarm = async () => {
    try {
      // Titreşim ve sesi durdur
      Vibration.cancel();
      if (alarmSound) {
        await alarmSound.stopAsync();
        await alarmSound.unloadAsync();
        setAlarmSound(null);
      }
      setIsAlarmActive(false);

      // Aktif alarmı bul ve sil
      const alarmsStr = await AsyncStorage.getItem('alarms');
      if (alarmsStr) {
        let alarms: Alarm[] = JSON.parse(alarmsStr);
        // Aktif alarmları filtrele (sil)
        alarms = alarms.filter(alarm => !alarm.isActive);
        // Güncellenmiş alarm listesini kaydet
        await AsyncStorage.setItem('alarms', JSON.stringify(alarms));
      }
    } catch (error) {
      console.error('Alarm durdurma hatası:', error);
    }
  };

  const handleMapPress = (e: any) => {
    const coordinate = e.nativeEvent.coordinate;
    console.log('Tıklanan nokta:', coordinate);

    const newDestination = {
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      name: 'Seçilen Konum',
    };
    
    setDestinationLocation(newDestination);
    
    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coordinate.latitude}&lon=${coordinate.longitude}&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'GeoAlarm/1.0',
          'Accept-Language': 'tr'
        }
      }
    )
    .then(response => response.json())
    .then(data => {
      const updatedDestination = {
        ...newDestination,
        name: data.display_name
      };
      setDestinationLocation(updatedDestination);
      setSearchQuery(data.display_name);
    })
    .catch(error => {
      console.error('Adres bulunamadı:', error);
    });
  };

  const stopBackgroundUpdate = async () => {
    try {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      console.log('Background location updates stopped.');
    } catch (err) {
      console.error('Error stopping location updates:', err);
    }
  };

  const handleRadiusChange = (value: number) => {
    const limitedValue = Math.min(value, 0.5);
    setAlarmRadius(limitedValue);
    if (destinationLocation) {
      const newCircle: CircleState = {
        center: {
          latitude: destinationLocation.latitude,
          longitude: destinationLocation.longitude,
        },
        radius: limitedValue * 1000, // km'yi metreye çevir
      };
      setCircle(newCircle);
      saveCircleToStorage(newCircle);
    }
  };

  // Titreşim deseni tanımı (dosyanın başına ekleyin)
  const Pattern = {
    ALARM: [0, 500, 200, 500], // [gecikme, titreşim, duraklama, titreşim]
  };

  // Marker tıklama işleyicisi için yeni state'ler ekleyelim
  const [selectedLocation, setSelectedLocation] = useState<DestinationState | null>(null);
  const [showLocationDetail, setShowLocationDetail] = useState(false);

  // Marker tıklama işleyicisi
  const handleMarkerPress = (location: DestinationState) => {
    setSelectedLocation(location);
    setShowLocationDetail(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Ionicons name="location" size={24} color="#4285F4" />
          <Text style={styles.logoText}>EG</Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => router.push('/(tabs)/scheduled-alarms')}
          >
            <Ionicons name="alarm-outline" size={20} color="#4285F4" />
            <Text style={styles.headerButtonText}>Alarmlar</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.headerButton}
            onPress={() => router.push('/(tabs)/saved-locations')}
          >
            <Ionicons name="bookmark-outline" size={20} color="#4285F4" />
            <Text style={styles.headerButtonText}>Kayıtlı Konumlar</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Konum ara..."
          value={searchQuery}
          onChangeText={handleSearch}
        />
      </View>

      {showResults && (
        <View style={styles.searchResultsContainer}>
          {isSearching ? (
            <ActivityIndicator color="#4285F4" />
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.place_id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultItem}
                  onPress={() => handleSelectSearchResult(item)}
                >
                  <Ionicons name="location-outline" size={20} color="#4285F4" />
                  <Text style={styles.resultText}>{item.display_name}</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      )}

      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={currentLocation || {
            latitude: 41.0082,
            longitude: 28.9784,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }}
          showsUserLocation
          onPress={handleMapPress}
        >
          {currentLocation && (
            <Marker
              coordinate={{
                latitude: currentLocation.latitude,
                longitude: currentLocation.longitude,
              }}
              title="Mevcut Konum"
            >
              <Ionicons name="location" size={32} color="#4285F4" />
            </Marker>
          )}

          {destinationLocation && (
            <>
              <Marker
                coordinate={{
                  latitude: destinationLocation.latitude,
                  longitude: destinationLocation.longitude,
                }}
                title={destinationLocation.name}
                onPress={() => handleMarkerPress(destinationLocation)}
              >
                <View style={styles.customMarker}>
                  <Ionicons name="location" size={32} color="#007AFF" />
                </View>
              </Marker>
              {circle && (
                <Circle
                  center={circle.center}
                  radius={circle.radius}
                  strokeWidth={2}
                  strokeColor="#4285F4"
                  fillColor="rgba(66, 133, 244, 0.1)"
                />
              )}
            </>
          )}
        </MapView>

        <View style={styles.mapControls}>
          <TouchableOpacity 
            style={styles.locationButton}
            onPress={async () => {
              const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced
              });
              
              const region = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              };
              
              setCurrentLocation(region);
              mapRef.current?.animateToRegion(region, 500);
            }}
          >
            <Ionicons name="locate" size={24} color="#4285F4" />
          </TouchableOpacity>

          <View style={styles.zoomControls}>
            <TouchableOpacity 
              style={styles.zoomButton}
              onPress={() => {
                if (mapRef.current) {
                  mapRef.current.getMapBoundaries().then((boundaries) => {
                    const currentRegion = {
                      latitude: (boundaries.northEast.latitude + boundaries.southWest.latitude) / 2,
                      longitude: (boundaries.northEast.longitude + boundaries.southWest.longitude) / 2,
                      latitudeDelta: Math.abs(boundaries.northEast.latitude - boundaries.southWest.latitude) * 0.5,
                      longitudeDelta: Math.abs(boundaries.northEast.longitude - boundaries.southWest.longitude) * 0.5,
                    };
                    
                    mapRef.current?.animateToRegion({
                      ...currentRegion,
                      latitudeDelta: currentRegion.latitudeDelta * 0.5,
                      longitudeDelta: currentRegion.longitudeDelta * 0.5,
                    }, 200);
                  });
                }
              }}
            >
              <Ionicons name="add" size={24} color="#4285F4" />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.zoomButton}
              onPress={() => {
                if (mapRef.current) {
                  mapRef.current.getMapBoundaries().then((boundaries) => {
                    const currentRegion = {
                      latitude: (boundaries.northEast.latitude + boundaries.southWest.latitude) / 2,
                      longitude: (boundaries.northEast.longitude + boundaries.southWest.longitude) / 2,
                      latitudeDelta: Math.abs(boundaries.northEast.latitude - boundaries.southWest.latitude) * 2,
                      longitudeDelta: Math.abs(boundaries.northEast.longitude - boundaries.southWest.longitude) * 2,
                    };
                    
                    mapRef.current?.animateToRegion({
                      ...currentRegion,
                      latitudeDelta: currentRegion.latitudeDelta * 2,
                      longitudeDelta: currentRegion.longitudeDelta * 2,
                    }, 200);
                  });
                }
              }}
            >
              <Ionicons name="remove" size={24} color="#4285F4" />
            </TouchableOpacity>
          </View>
        </View>

        {destinationLocation && (
          <View style={styles.radiusControl}>
            <Text style={styles.radiusText}>
              Yarıçap: {alarmRadius.toFixed(1)} km ({(alarmRadius * 1000).toFixed(0)} metre)
            </Text>
            <Slider
              style={styles.slider}
              minimumValue={0.1}
              maximumValue={0.5}
              step={0.1}
              value={alarmRadius}
              onValueChange={handleRadiusChange}
              minimumTrackTintColor="#4285F4"
              thumbTintColor="#4285F4"
            />
          </View>
        )}
      </View>

      <View style={styles.bottomContainer}>
        <TouchableOpacity style={styles.setAlarmButton} onPress={handleSetAlarm}>
          <Text style={styles.setAlarmButtonText}>Alarm Kur</Text>
        </TouchableOpacity>
        
        {isAlarmActive && (
          <TouchableOpacity 
            style={[styles.setAlarmButton, { backgroundColor: '#FF4444', marginTop: 8 }]} 
            onPress={stopAlarm}
          >
            <Text style={styles.setAlarmButtonText}>Alarmı Durdur</Text>
          </TouchableOpacity>
        )}
      </View>

      <StatusBar style="auto" />

      {showLocationDetail && selectedLocation && (
        <View style={styles.locationDetailCard}>
          <View style={styles.locationDetailHeader}>
            <Text style={styles.locationDetailTitle}>{selectedLocation.name}</Text>
            <TouchableOpacity 
              onPress={() => setShowLocationDetail(false)}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4285F4',
    marginLeft: 8,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4285F4',
    backgroundColor: 'white',
    gap: 4,
  },
  headerButtonText: {
    color: '#4285F4',
    fontSize: 14,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    paddingHorizontal: 16,
    height: 44,
    backgroundColor: '#f5f5f5',
    borderRadius: 22,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  searchResultsContainer: {
    position: 'absolute',
    top: 130,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: 200,
    zIndex: 1,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  resultText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#333',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  setAlarmButton: {
    backgroundColor: '#4285F4',
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  setAlarmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  mapControls: {
    position: 'absolute',
    right: 16,
    top: '50%',
    transform: [{ translateY: -100 }],
    alignItems: 'center',
    gap: 16,
    zIndex: 1,
  },
  locationButton: {
    backgroundColor: 'white',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  zoomControls: {
    alignItems: 'center',
    gap: 8,
  },
  zoomButton: {
    backgroundColor: 'white',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  radiusControl: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  radiusText: {
    fontSize: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  customMarker: {
    alignItems: 'center',
  },
  locationDetailCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  locationDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  locationDetailTitle: {
    fontSize: 16,
    fontWeight: '400',
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    right: 0,
    padding: 4,
  },
});
