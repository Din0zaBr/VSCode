// Правила корреляции теперь находятся в разделе "Хранилище данных"
// Этот файл оставлен для обратной совместимости
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
export default function CorrelationRules() {
  const navigate = useNavigate();
  useEffect(() => { navigate("/data", { replace: true }); }, [navigate]);
  return null;
}
