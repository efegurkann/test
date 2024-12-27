import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, Vibration } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAlarm } from '../../context/AlarmContext';

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

export default function ScheduledAlarmsScreen() {
  const router = useRouter();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const { isAlarmActive, setIsAlarmActive, alarmSound, setAlarmSound } = useAlarm();

  useEffect(() => {
    loadAlarms();
  }, []);

  const loadAlarms = async () => {
    try {
      const alarmsStr = await AsyncStorage.getItem('alarms');
      if (alarmsStr) {
        const loadedAlarms = JSON.parse(alarmsStr);
        setAlarms(loadedAlarms);
      }
    } catch (error) {
      console.error('Alarmlar yüklenemedi:', error);
    }
  };

  const deleteAlarm = async (id: string) => {
    try {
      const alarmsStr = await AsyncStorage.getItem('alarms');
      let alarms: Alarm[] = alarmsStr ? JSON.parse(alarmsStr) : [];
      
      const deletedAlarm = alarms.find(alarm => alarm.id === id);
      
      alarms = alarms.filter(alarm => alarm.id !== id);
      await AsyncStorage.setItem('alarms', JSON.stringify(alarms));

      if (deletedAlarm && isAlarmActive) {
        try {
          Vibration.cancel();
          if (alarmSound) {
            await alarmSound.stopAsync();
            await alarmSound.unloadAsync();
          }
          setIsAlarmActive(false);
          setAlarmSound(null);
        } catch (error) {
          console.error('Alarm durdurma hatası:', error);
        }
      }

      loadAlarms();
      Alert.alert('Başarılı', 'Alarm silindi!');
    } catch (error) {
      console.error('Alarm silinemedi:', error);
      Alert.alert('Hata', 'Alarm silinirken bir hata oluştu!');
    }
  };

  const renderAlarmItem = ({ item }: { item: Alarm }) => (
    <View style={styles.alarmItem}>
      <View style={styles.alarmInfo}>
        <Text style={styles.locationName}>{item.location.name}</Text>
        <Text style={styles.alarmDetails}>
          Yarıçap: {item.radius} km
        </Text>
      </View>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => {
          Alert.alert(
            'Alarmı Sil',
            'Bu alarmı silmek istediğinizden emin misiniz?',
            [
              { text: 'İptal', style: 'cancel' },
              { text: 'Sil', style: 'destructive', onPress: () => deleteAlarm(item.id) }
            ]
          );
        }}
      >
        <Ionicons name="trash-outline" size={24} color="red" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#4285F4" />
        </TouchableOpacity>
        <Text style={styles.title}>Programlı Alarmlar</Text>
      </View>

      <FlatList
        data={alarms}
        renderItem={renderAlarmItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.alarmList}
        ListEmptyComponent={() => (
          <Text style={styles.emptyText}>Henüz alarm eklenmemiş</Text>
        )}
      />
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
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    marginRight: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  alarmList: {
    padding: 16,
  },
  alarmItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  alarmInfo: {
    flex: 1,
    marginRight: 16,
  },
  locationName: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  alarmDetails: {
    fontSize: 14,
    color: '#666',
  },
  deleteButton: {
    padding: 8,
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 32,
  },
}); 